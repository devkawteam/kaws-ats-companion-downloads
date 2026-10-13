"""Optional offline speech service for KAW's ATS Companion. Author: Kaw.

Piper voices and a local faster-whisper model are installed separately. No models
are downloaded by the running service. Audio is handled in memory, not saved.
"""
import argparse
import base64
import importlib.util
import io
import json
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


class SpeechRuntime:
    def __init__(self, voice_dir, whisper_dir):
        self.voice_dir = Path(voice_dir).resolve()
        self.whisper_dir = Path(whisper_dir).resolve()
        self.lock = threading.Lock()
        self.voice = None
        self.voice_name = None
        self.whisper = None

    def voices(self):
        return sorted(p.stem for p in self.voice_dir.glob('*.onnx')
                      if p.is_file() and Path(str(p) + '.json').is_file())

    def status(self):
        return {'available': True, 'voices': self.voices(),
                'piperInstalled': importlib.util.find_spec('piper') is not None,
                'whisperInstalled': importlib.util.find_spec('faster_whisper') is not None,
                'whisperReady': (self.whisper_dir / 'model.bin').is_file()}

    def speak(self, body):
        name, text = body.get('voice'), body.get('text')
        if name not in self.voices():
            raise ValueError('Choose a voice installed in local-speech/voices.')
        if not isinstance(text, str) or not text.strip() or len(text) > 1800:
            raise ValueError('Speech text must be 1–1800 characters.')
        from piper import PiperVoice
        if name != self.voice_name:
            self.voice = PiperVoice.load(str(self.voice_dir / (name + '.onnx')))
            self.voice_name = name
        output = io.BytesIO()
        with wave.open(output, 'wb') as wav:
            self.voice.synthesize_wav(text, wav)
        return output.getvalue()

    def transcribe(self, body):
        if not (self.whisper_dir / 'model.bin').is_file():
            raise ValueError('Download the Whisper model first; see FREE-LOCAL-AI.md.')
        encoded = body.get('audio')
        if not isinstance(encoded, str) or len(encoded) > 240000:
            raise ValueError('Recording is too large.')
        audio = base64.b64decode(encoded, validate=True)
        if not audio:
            raise ValueError('Recording is empty.')
        # Limit decoded duration too, so compressed uploads cannot request long jobs.
        from faster_whisper.audio import decode_audio
        samples = decode_audio(io.BytesIO(audio), sampling_rate=16000)
        if len(samples) > 20 * 16000:
            raise ValueError('Record a question shorter than 20 seconds.')
        from faster_whisper import WhisperModel
        if self.whisper is None:
            self.whisper = WhisperModel(str(self.whisper_dir), device='cpu', compute_type='int8', local_files_only=True)
        segments, _ = self.whisper.transcribe(samples, language='en', beam_size=1, vad_filter=True)
        return {'text': ' '.join(s.text.strip() for s in segments).strip()[:1200]}


def make_handler(runtime):
    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_args):
            pass  # Do not log voice text or recordings.

        def send(self, status, payload, content_type='application/json'):
            data = json.dumps(payload).encode() if content_type == 'application/json' else payload
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)

        def allowed(self):
            # Only the Node Companion talks to this service. No browser origins.
            return self.client_address[0] == '127.0.0.1' and not self.headers.get('Origin') and self.headers.get('Host') == '127.0.0.1:4281'

        def do_GET(self):
            if not self.allowed():
                return self.send(403, {'error': 'Local Companion connections only.'})
            if self.path == '/health':
                return self.send(200, runtime.status())
            if self.path == '/voices':
                return self.send(200, {'voices': runtime.voices()})
            self.send(404, {'error': 'Not found.'})

        def do_POST(self):
            if not self.allowed():
                return self.send(403, {'error': 'Local Companion connections only.'})
            if self.path not in ('/speak', '/transcribe'):
                return self.send(404, {'error': 'Not found.'})
            if not runtime.lock.acquire(blocking=False):
                return self.send(409, {'error': 'Speech service is busy. Try again shortly.'})
            try:
                length = int(self.headers.get('Content-Length', '0'))
                if length <= 0 or length > 256 * 1024:
                    return self.send(413, {'error': 'Invalid recording or request size.'})
                body = json.loads(self.rfile.read(length))
                if not isinstance(body, dict):
                    raise ValueError('Expected a JSON object.')
                if self.path == '/speak':
                    return self.send(200, runtime.speak(body), 'audio/wav')
                self.send(200, runtime.transcribe(body))
            except (ValueError, KeyError) as error:
                self.send(400, {'error': str(error)})
            except ImportError:
                self.send(503, {'error': 'Install the optional speech requirements first.'})
            except Exception:
                self.send(500, {'error': 'Local speech processing failed. Check the model files and retry.'})
            finally:
                runtime.lock.release()
    return Handler


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--voices', default=str(Path(__file__).parent / 'voices'))
    parser.add_argument('--whisper-model', default=str(Path(__file__).parent / 'models' / 'whisper-base.en'))
    args = parser.parse_args()
    runtime = SpeechRuntime(args.voices, args.whisper_model)
    server = ThreadingHTTPServer(('127.0.0.1', 4281), make_handler(runtime))
    server.timeout = 30
    print('KAW offline speech bridge: http://127.0.0.1:4281 (CPU only)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
