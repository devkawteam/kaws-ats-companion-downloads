"""Optional CPU speech service. Loopback only; no file paths or commands accepted."""
import argparse, io, json, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import onnxruntime as rt
import soundfile as sf
from kokoro_onnx import Kokoro

p = argparse.ArgumentParser()
p.add_argument('--model', required=True)
p.add_argument('--voices', required=True)
args = p.parse_args()
opts = rt.SessionOptions(); opts.intra_op_num_threads = 2; opts.inter_op_num_threads = 1
engine = Kokoro.from_session(rt.InferenceSession(args.model, sess_options=opts, providers=['CPUExecutionProvider']), args.voices)
catalog = []
for key in engine.voices.files:
    if key[:2] not in ('af', 'am', 'bf', 'bm'): continue
    lang = 'en-US' if key[0] == 'a' else 'en-GB'
    catalog.append(dict(id=f'{lang}-Kokoro-{key}', name=key[3:].title(), lang=lang,
                        accent='American' if key[0]=='a' else 'British', english=True,
                        gender='male' if key[1]=='m' else 'female', provider='Kokoro • local CPU'))
allowed = {v['id']: v for v in catalog}
slots = threading.BoundedSemaphore(3)
lock = threading.Lock()
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args): pass  # Never log reply text.
    def reply(self, status, data, mime='application/json'):
        if mime=='application/json': data=json.dumps(data).encode()
        self.send_response(status); self.send_header('Content-Type',mime)
        self.send_header('Content-Length',str(len(data))); self.send_header('Cache-Control','no-store')
        self.end_headers(); self.wfile.write(data)
    def do_GET(self):
        if self.path not in ('/voices','/api/voice/voices'): return self.reply(404, {'error':'Not found'})
        self.reply(200, dict(enabled=True, voices=catalog, provider='Kokoro', note='Free local English voices; reply text stays on this PC.'))
    def do_POST(self):
        if self.path not in ('/speak','/api/voice/speak'): return self.reply(404, {'error':'Not found'})
        # Browser pages cannot call this service directly, including from localhost.
        if self.headers.get('Origin'): return self.reply(403, {'error':'Use the Companion'})
        if not slots.acquire(blocking=False): return self.reply(429, {'error':'Local voices are busy; using browser voice.'})
        try:
            size=int(self.headers.get('Content-Length','0'))
            if not 0<size<=12000: return self.reply(400, {'error':'Invalid request size'})
            self.connection.settimeout(5)
            body=json.loads(self.rfile.read(size)); voice=allowed.get(body.get('voice'))
            text=body.get('text'); rate=float(body.get('rate',1))
            if not voice or not isinstance(text,str) or not 1<=len(text)<=600 or not .5<=rate<=2:
                return self.reply(400, {'error':'Invalid voice, text or speed'})
            if not lock.acquire(timeout=12): return self.reply(429, {'error':'Local voice queue timed out'})
            try:
                key=voice['id'].split('Kokoro-')[1]
                audio,sr=engine.create(text,voice=key,speed=rate,lang=voice['lang'].lower())
                buf=io.BytesIO(); sf.write(buf,audio,sr,format='WAV')
                self.reply(200,buf.getvalue(),'audio/wav')
            finally: lock.release()
        except (BrokenPipeError,ConnectionResetError): pass
        except Exception: self.reply(400, {'error':'Local speech failed; try the browser voice.'})
        finally: slots.release()
ThreadingHTTPServer(('127.0.0.1',4312),Handler).serve_forever()
