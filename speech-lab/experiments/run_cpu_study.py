"""Run this explicitly: serial CPU study, owned processes, managed outputs only."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time

ROOT = Path(os.environ['LOCALAPPDATA'])/'com.aiditor.app/speech-lab'
OUTPUT = Path(json.loads((ROOT/'experiments/active-cpu-study.json').read_text())['folder'])
SCRIPT = Path(__file__).with_name('cpu_hinglish.py')
MAIN_PYTHON = Path(__file__).resolve().parents[2]/'.speech-lab-venv/Scripts/python.exe'


def digest(path):
    with path.open('rb') as source: return hashlib.file_digest(source, 'sha256').hexdigest()


if __name__ == '__main__':
    checkpoint_hashes = {model: digest(ROOT/'models'/model/'model.safetensors') for model in ('srota','shunya')}
    cases = [('srota-sdk-sdpa-t'+str(t), 'srota', 'srota', ['--threads',str(t)]) for t in [4,1,2,6,8]]
    cases += [
        ('srota-sdk-auto-t4','srota','srota',['--threads','4','--attention','auto']),
        ('srota-direct-registered-t4','srota','srota',['--threads','4','--integration','direct-registered']),
        ('srota-direct-hf-t4','srota','srota',['--threads','4','--integration','direct-hf']),
        ('srota-sdk-int8-t4','srota','srota',['--threads','4','--quantization','int8']),
        ('shunya-conversion','shunya','convert-shunya',['--threads','4']),
        ('shunya-ct2-int8-t4','main','shunya',['--threads','4','--integration','ct2']),
        ('shunya-ct2-int8-words-t4','main','shunya',['--threads','4','--integration','ct2','--word-timestamps']),
        ('shunya-pytorch-t4','shunya','shunya',['--threads','4','--integration','pytorch']),
    ]
    results = {'started': time.time(), 'checkpointHashesBefore': checkpoint_hashes, 'runs': []}
    for name, environment, action, options in cases:
        target = OUTPUT/(name+'.json')
        python = MAIN_PYTHON if environment == 'main' else ROOT/'runtimes'/environment/'Scripts/python.exe'
        command = [str(python),'-u','-B',str(SCRIPT),action,'--output',str(target),*options]
        env = dict(os.environ, PYTHONIOENCODING='utf-8', HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1')
        if name == 'srota-direct-hf-t4': env['PYTHONPATH'] = str(OUTPUT/'direct-hf-overlay')
        started = time.perf_counter()
        print('START',name,flush=True)
        with (OUTPUT/(name+'.log')).open('w',encoding='utf-8') as log:
            process = subprocess.Popen(command,stdout=log,stderr=subprocess.STDOUT,env=env)
            timed_out = False
            while process.poll() is None:
                if time.perf_counter()-started > 900:
                    # Experiment watchdog only, never used in the editor's ASR path.
                    subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=log,stderr=log)
                    process.wait();timed_out=True;break
                time.sleep(.5)
        result={'name':name,'exitCode':process.returncode,'wallSec':time.perf_counter()-started,'watchdogExceeded':timed_out}
        if target.exists():
            data=json.loads(target.read_text(encoding='utf-8'))
            result.update({'status':data.get('status'),'error':data.get('error'),'timings':data.get('timings'),
                           'characters':len(data.get('finalTranscript','')),'metrics':data.get('metrics')})
        else: result['status']='native-crash' if process.returncode else 'missing-result'
        results['runs'].append(result)
        (OUTPUT/'study-index.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
        print('DONE',json.dumps(result),flush=True)
    results['checkpointHashesAfter']={model:digest(ROOT/'models'/model/'model.safetensors') for model in checkpoint_hashes}
    results['originalCheckpointsUnchanged']=results['checkpointHashesAfter']==checkpoint_hashes
    results['finished']=time.time()
    (OUTPUT/'study-index.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    print('STUDY COMPLETE',OUTPUT,flush=True)
