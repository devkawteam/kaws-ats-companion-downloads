"""Speech bridge smoke tests; use fake engines, no model downloads."""
import http.client
import importlib.util
import json
import tempfile
import threading
import unittest
from pathlib import Path
from http.server import ThreadingHTTPServer

spec = importlib.util.spec_from_file_location('bridge', Path(__file__).with_name('bridge.py'))
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


class FakeRuntime:
    def __init__(self):
        self.lock = threading.Lock()

    def status(self):
        return {'available': True, 'voices': ['test-voice']}

    def voices(self):
        return ['test-voice']

    def speak(self, body):
        if body.get('voice') != 'test-voice':
            raise ValueError('Unknown voice')
        return b'RIFF-test-wave'

    def transcribe(self, body):
        return {'text': 'How far?'}


class BridgeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime = FakeRuntime()
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), bridge.make_handler(cls.runtime))
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.server.server_port, timeout=3)
        default_headers = {'Host': '127.0.0.1:4281', 'Content-Type': 'application/json'}
        default_headers.update(headers or {})
        connection.request(method, path, json.dumps(body) if body is not None else None, default_headers)
        response = connection.getresponse()
        result = response.status, response.getheader('Content-Type'), response.read()
        connection.close()
        return result

    def test_health_and_audio(self):
        status, _, body = self.request('GET', '/health')
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['voices'], ['test-voice'])
        status, mime, body = self.request('POST', '/speak', {'voice': 'test-voice', 'text': 'Hello'})
        self.assertEqual((status, mime, body), (200, 'audio/wav', b'RIFF-test-wave'))

    def test_browser_origin_and_rebinding_are_rejected(self):
        self.assertEqual(self.request('POST', '/speak', {}, {'Origin': 'https://other.example'})[0], 403)
        self.assertEqual(self.request('GET', '/health', headers={'Host': 'other.example'})[0], 403)

    def test_busy_and_invalid_request(self):
        self.runtime.lock.acquire()
        try:
            self.assertEqual(self.request('POST', '/speak', {})[0], 409)
        finally:
            self.runtime.lock.release()
        self.assertEqual(self.request('POST', '/speak', {'voice': 'missing'})[0], 400)
        self.assertEqual(self.request('POST', '/speak', [1, 2])[0], 400)

    def test_transcript_route(self):
        status, _, body = self.request('POST', '/transcribe', {'audio': 'AAAA'})
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body)['text'], 'How far?')

    def test_real_runtime_lists_only_complete_voice_pairs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'complete.onnx').touch()
            (root / 'complete.onnx.json').touch()
            (root / 'incomplete.onnx').touch()
            runtime = bridge.SpeechRuntime(root, root / 'models')
            self.assertEqual(runtime.voices(), ['complete'])
            self.assertFalse(runtime.status()['whisperReady'])
            with self.assertRaises(ValueError):
                runtime.speak({'voice': '../escape', 'text': 'Hello'})
            with self.assertRaises(ValueError):
                runtime.transcribe({'audio': 'AAAA'})


if __name__ == '__main__':
    unittest.main()
