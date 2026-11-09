"""Summarize saved measurements, never score accuracy without a human reference."""
import csv
import json
import os
from pathlib import Path
import re

ROOT = Path(os.environ['LOCALAPPDATA'])/'com.aiditor.app/speech-lab'
OUTPUT = Path(json.loads((ROOT/'experiments/active-cpu-study.json').read_text())['folder'])


def summarize():
    rows = []
    for file in sorted(OUTPUT.glob('*.json')):
        if not file.name.startswith(('srota-', 'shunya-', 'shruti-')): continue
        data = json.loads(file.read_text(encoding='utf-8'))
        if 'configuration' not in data and 'conversionSec' not in data: continue
        configuration, metrics, timings = data.get('configuration', {}), data.get('metrics', {}), data.get('timings', {})
        text, generations = data.get('finalTranscript',''), []
        parser_changes = 0
        for chunk in data.get('chunks', []):
            chunk_generations = chunk.get('generation', [])
            generations.extend(chunk_generations)
            if len(chunk_generations) == 1:
                raw = chunk_generations[0]['rawTextBeforeParsing']
                plain = raw.split('<asr_text>',1)[1].strip() if '<asr_text>' in raw else raw.strip()
                parser_changes += plain != chunk['textAfterParsing']
        is_shruti = configuration.get('action') == 'shruti'
        rows.append({'case': file.stem, 'status': data.get('status'), 'threads': None if is_shruti else configuration.get('threads'),
            'integration': 'needle' if is_shruti else configuration.get('integration'),
            'attentionRequested': configuration.get('attention') if configuration.get('action') == 'srota' else None,
            'attentionActual': data.get('runtime',{}).get('actualAttention'),
            'quantization': 'int4 weights/int8 activations' if is_shruti else 'int8' if configuration.get('integration') == 'ct2' else configuration.get('quantization'),
            'chunkSeconds': configuration.get('chunk_seconds',30) if configuration.get('action') == 'srota' else None,
            'loadSec': timings.get('modelLoadSec',data.get('modelLoadSec')),
            'inferenceSec': timings.get('inferenceSec',data.get('inferenceSec')),
            'processingSec': timings.get('processingSec',data.get('processingSec')),
            'peakRamGB': metrics.get('peakRamBytes',0)/1e9, 'cpuPercentMachine': metrics.get('cpuPercentMachine'),
            'hasLatin': bool(re.search('[A-Za-z]',text)), 'hasDevanagari': bool(re.search('[\u0900-\u097f]',text)),
            'outputCharactersDescriptiveOnly': len(text),
            'inputChunks': len(data.get('chunks',[])) if generations else None,
            'nativeSegments': len(data.get('chunks',[])) if configuration.get('integration') == 'ct2' else None,
            'generatedTokens': sum(g['generatedTokenCount'] for g in generations) if generations else None,
            'tokenLimitReachedChunks': sum(g['reachedTokenLimit'] for g in generations) if generations else None,
            'eosChunks': sum(g['endedWithEos'] for g in generations) if generations else None,
            'parserChangedChunks': parser_changes if generations else None,
            'hasLegoHypothesisAnchor': bool(re.search(r'lego|लेगो|लेगों|लैगो',text,re.I)),
            'hasBlinkitHypothesisAnchor': bool(re.search(r'blinkit|blinket|ब्लिंकिट|ब्लिंकेट|ब्लिंक\s*किट',text,re.I)),
            'nativeWordCount':len(data.get('words',[])), 'error': data.get('error'),
            'accuracyNote':'No manually verified reference; anchors are hypothesis coverage checks, not accuracy scores.'})
    (OUTPUT/'comparison.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2),encoding='utf-8')
    if rows:
        with (OUTPUT/'comparison.csv').open('w',encoding='utf-8-sig',newline='') as target:
            writer=csv.DictWriter(target,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    return rows


if __name__ == '__main__':
    for row in summarize():
        print(json.dumps(row,ensure_ascii=True))
