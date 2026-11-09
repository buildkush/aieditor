import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import MagicMock, patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import worker_process as runtime

class WorkerProcessTests(unittest.TestCase):
    def test_child_protocol_keeps_original_error_and_source(self):
        audio = {'audioPath': 'prepared.wav', 'audioSha256': 'same'}
        process = MagicMock()
        process.stdout = io.StringIO(json.dumps({'type': 'error', 'data': {'message': 'specific failure'}}) + '\n')
        process.stdin = MagicMock()
        process.poll.return_value = 1
        events = []
        with patch('subprocess.Popen', return_value=process):
            runtime.relay('python', 'child.py', 'root', {'model': 'shunya-int8', 'prepared': audio}, lambda kind, data: events.append((kind, data)))
        self.assertEqual(events, [('error', {'message': 'specific failure'})])
        self.assertEqual(json.loads(process.stdin.write.call_args.args[0])['prepared'], audio)

    def test_native_crash_reports_windows_status_instead_of_waiting_for_result(self):
        process = MagicMock()
        process.stdout = io.StringIO('')
        process.stdin = MagicMock()
        process.poll.return_value = 3221225477
        process.returncode = 3221225477
        with patch('subprocess.Popen', return_value=process):
            with self.assertRaisesRegex(RuntimeError, '0xC0000005'):
                runtime.relay('python', 'child.py', 'root', {'model': 'shunya-int8'}, lambda *_: None)


if __name__ == '__main__': unittest.main()
