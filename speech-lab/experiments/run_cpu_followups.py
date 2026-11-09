"""Serial follow-ups to the explicit CPU study; never run alongside its models."""
import json
import os
import subprocess
import time
from run_cpu_study import ROOT, OUTPUT, SCRIPT, MAIN_PYTHON, digest


if __name__ == '__main__':
    while True:
        try:
            initial = json.loads((OUTPUT/'study-index.json').read_text(encoding='utf-8'))
            if initial.get('finished'): break
        except (OSError, ValueError): pass
        time.sleep(1)
    cases = [
        ('srota-direct-registered-t4-corrected','srota',['srota','--threads','4','--integration','direct-registered'],False),
        ('srota-short10-t2','srota',['srota','--threads','2','--chunk-seconds','10'],False),
        ('srota-decoder-int8-t2','srota',['srota','--threads','2','--quantization','decoder-int8'],False),
        ('srota-native-conversion','srota',['convert-srota','--threads','4'],True),
        ('srota-direct-native-hf-t4','srota',['srota','--threads','4','--integration','direct-hf','--native-converted'],True),
        ('shruti-baseline','main',['shruti','--threads','4'],False),
    ]
    results={'started':time.time(),'runs':[]}
    for name, runtime, options, overlay in cases:
        print('START',name,flush=True)
        python=MAIN_PYTHON if runtime=='main' else ROOT/'runtimes'/runtime/'Scripts/python.exe'
        target=OUTPUT/(name+'.json')
        env=dict(os.environ,PYTHONIOENCODING='utf-8',HF_HUB_OFFLINE='1',TRANSFORMERS_OFFLINE='1')
        if overlay:env['PYTHONPATH']=str(OUTPUT/'direct-hf-overlay')
        start=time.perf_counter()
        with (OUTPUT/(name+'.log')).open('w',encoding='utf-8') as log:
            process=subprocess.Popen([str(python),'-u','-B',str(SCRIPT),*options,'--output',str(target)],env=env,stdout=log,stderr=subprocess.STDOUT)
            timed_out=False
            while process.poll() is None:
                if time.perf_counter()-start>900:
                    subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],stdout=log,stderr=log)
                    process.wait();timed_out=True;break
                time.sleep(.5)
        record={'name':name,'exitCode':process.returncode,'wallSec':time.perf_counter()-start,'watchdogExceeded':timed_out}
        if target.exists():
            data=json.loads(target.read_text(encoding='utf-8'))
            record.update({'status':data.get('status'),'error':data.get('error'),'timings':data.get('timings'),
                           'characters':len(data.get('finalTranscript','')),'metrics':data.get('metrics')})
        else:record['status']='native-crash' if process.returncode else 'missing-result'
        results['runs'].append(record)
        (OUTPUT/'followups-index.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
        print('DONE',json.dumps(record),flush=True)
    results['checkpointHashesAfter']={model:digest(ROOT/'models'/model/'model.safetensors') for model in ('srota','shunya')}
    results['originalCheckpointsUnchanged']=results['checkpointHashesAfter']==initial['checkpointHashesBefore']
    results['finished']=time.time()
    (OUTPUT/'followups-index.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    print('FOLLOWUPS COMPLETE',OUTPUT,flush=True)
