"""Owned offline inference child process protocol shared by CPU profiles."""
import json
import subprocess

def relay(python, script, root, payload, emit, env=None):
    model = payload['model']
    # Rust cancellation terminates the entire owned process tree, including native inference.
    process = subprocess.Popen([str(python), '-u', str(script), str(root)], env=env,
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding='utf-8')
    terminal = False
    try:
        process.stdin.write(json.dumps(payload)); process.stdin.close()
        for line in process.stdout:
            try:
                event = json.loads(line)
            except ValueError:
                continue
            emit(event['type'], event['data'])
            terminal |= event['type'] in ('result', 'error')
        process.wait()
    finally:
        process.stdout.close()
        if process.poll() is None:
            process.kill(); process.wait()
    if not terminal:
        code = process.returncode
        status = f'0x{code & 0xffffffff:08X}' if code is not None else 'unknown'
        raise RuntimeError(f'{model} inference process exited without a result (status {status}). '
                           'The native runtime may have crashed; cancel and retry after updating the runtime.')
    # Child has already emitted the terminal result. Do not overwrite it.

