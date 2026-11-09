"""Build the final study report from completed measurements, not estimates."""
import json
from pathlib import Path
from summarize_cpu_study import OUTPUT, summarize


def load(name):
    data=json.loads((OUTPUT/(name+'.json')).read_text(encoding='utf-8'))
    if data.get('status')!='complete': raise ValueError('Required completed experiment missing: '+name)
    return data


if __name__=='__main__':
    rows=summarize()
    lookup={row['case']:row for row in rows}
    native=load('srota-direct-native-short10-t2')
    conv=load('shunya-conversion')
    tensor_integrity=json.loads((OUTPUT/'srota-native-tensor-integrity.json').read_text())
    integrity=json.loads((OUTPUT/'final-original-model-integrity.json').read_text())
    assert tensor_integrity['allOriginalTensorBytesPreserved']
    assert all(value['unchanged'] for value in integrity['checkpoints'].values())
    srota=[load(row['case']) for row in rows if row['status']=='complete' and row['case'].startswith('srota-') and row['inferenceSec'] is not None]
    generations=[g for data in srota for chunk in data['chunks'] for g in chunk['generation']]
    budget_hits=sum(g['reachedTokenLimit'] for g in generations)
    highest=max(g['generatedTokenCount'] for g in generations)
    def performance_table(names):
        lines=['| Experiment | Load s | Inference s | Processing s | Peak RAM GB | CPU % of machine |',
               '| --- | ---: | ---: | ---: | ---: | ---: |']
        for name in names:
            row=lookup[name]
            lines.append('| '+name+' | '+' | '.join(f'{row[key]:.2f}' for key in ['loadSec','inferenceSec','processingSec','peakRamGB','cpuPercentMachine'])+' |')
        return '\n'.join(lines)
    thread_table=performance_table(['srota-sdk-sdpa-t'+str(t) for t in [1,2,4,6,8]])
    primary_table=performance_table(['shruti-baseline','srota-sdk-sdpa-t2','srota-short10-t2',
        'srota-direct-registered-t4-corrected','srota-direct-native-tied-hf-t4','srota-direct-native-short10-t2',
        'srota-sdk-int8-t4','srota-decoder-int8-t2','shunya-pytorch-t4','shunya-ct2-int8-t4','shunya-ct2-int8-words-t4'])
    text=f'''# CPU-only Hinglish ASR: completed targeted experiments

Date: 2026-11-04. Machine: Intel Core i7-1165G7, 4 physical cores / 8 logical CPUs, approximately 16 GB RAM, Windows. All inference was local and CPU-only.

## Recommendations

1. **Srota resource/coverage balance for further Audio Lab testing:** native Transformers 5.22.1, PyTorch 2.10.0+cpu, FP32, SDPA, two intra-op threads, one inter-op thread, batch size 1, pause-aware input spans no longer than 10 seconds, unforced language (equivalent to SDK `language=None`), and unchanged `max_new_tokens=1024`. This exact combination completed in {lookup['srota-direct-native-short10-t2']['inferenceSec']:.2f} seconds inference with {lookup['srota-direct-native-short10-t2']['peakRamGB']:.2f} GB peak RAM and about {lookup['srota-direct-native-short10-t2']['cpuPercentMachine']:.0f}% total CPU use. It recovered the closing section but still makes phrase and spelling errors. It requires the separate, verified native-format checkpoint; it is not a drop-in dependency upgrade for the current SDK environment.
2. **BF16:** not tested as an inference optimization, because this CPU/runtime reports no native AVX-512 BF16 or AMX support. FP32 is retained. No CPU FP16 inference was attempted. BF16 source/converted weight storage is distinct from CPU inference precision; all Srota inference trials executed in FP32 or explicitly tested INT8.
3. **Direct Transformers and completeness:** bypassing only SDK inference/parsing produced identical generated IDs and text. Native Transformers with converted weights used less memory and was modestly faster, but 30-second calls still omitted later material. The direct interface alone does not fix incomplete transcription.
4. **Srota reliability:** not established. Ten-second windows recovered Lego/Blinkit closing material missing from the 30-second runs, but other omissions and spelling errors remain. One recording and no verified human transcript cannot establish general accuracy or dependable complete recognition.
5. **Shunya CTranslate2 INT8:** conversion and complete-recording inference succeeded. CPU compute types were probed before conversion/inference; actual execution used `int8_float32`, four threads. The word-timestamp run returned 280 native words through 83.66 seconds. This is a useful experimental replacement runtime candidate, not an automatic replacement of the original integration.
6. **Production baseline:** Shruti remains the practical fast baseline. It completed the fresh trial in 12.30 seconds inference with 0.15 GB peak RAM and 277 native word times. Its transcript matched the earlier recorded baseline; it still has English spelling errors. Nothing was promoted or substituted in the editor.

## Common benchmark and controls

All recognizer trials used the same 83.68475-second prepared recording, 1,338,956 samples of mono 16 kHz PCM. SHA-256: `37ab9889d875f832dd80f99423db2ecabc65d1262d9a71f29e698214c150c595`. The experiment refuses an unexpected checksum or sample count. Source media and checkpoints are read-only. No denoising, enhancement, AGC, translation, Roman conversion, new vocabulary or forced-alignment model was introduced. VAD filtering was disabled. Chunk boundaries do not remove or duplicate samples.

The SDK thread/attention tests used the current pause-aware maximum-30-second partition: 0–27.8, 27.8–54.9, 54.9–83.68475 seconds. Short-window trials used the same helper with a 10-second maximum and produced 11 consecutive input spans. Language was never forced. No generation budget increase, forced minimum output length, EOS suppression or sampling adjustment was applied.

Trials were serial fresh processes. These are exploratory single-machine measurements, not repeated statistical benchmarks. Desktop background load, caches, power/thermal behavior and trial order were not controlled. CPU percentage is a headroom proxy, not a direct editor-interaction latency test. Framework-specific load measurements include their initialization path; subprocess wall times are also saved in run indexes. Peak RAM covers the process's load/quantization/inference phases, not only steady-state weights. Historical Shruti inference was 6.24 seconds; the fresh run was 12.30 seconds with identical text, illustrating that elapsed times vary with machine state.

## Completed timing and memory comparison

Processing is the measured load/quantization/inference stage total. See individual JSON and indexes for process startup and wall time. RAM uses decimal GB.

{primary_table}

Broad and decoder-only INT8 results are **rejected**, despite short inference times: they returned malformed, near-empty or substantially corrupted content. They are not valid quality-preserving speedups. Word timestamps were off in the PyTorch Shunya trial, optional in the CTranslate2 trials, and unavailable for Srota without a separate aligner.

## Srota thread and attention tests

{thread_table}

All five thread counts produced identical generated token IDs and parsed transcripts. Two threads were within approximately one second of four-thread inference while using roughly half the CPU percentage. Six and eight threads increased CPU use without improving speed. The one-thread run had the most headroom but took longer.

Explicit SDPA: 130.76 seconds inference; unspecified attention: 132.92 seconds. Both actually selected SDPA and produced identical generated IDs/text. There was no different attention algorithm to choose between in this runtime. All tests used one inter-op thread.

## Incomplete Srota output: actual decoder evidence

Across {len(generations)} captured chunk generations, **{budget_hits} reached the 1,024-token cap**. The largest generation had {highest} tokens. EOS was observed rather than inferred from character count. A normal EOS does not mean every spoken word was recognized: even badly degraded INT8 outputs ended at EOS.

The FP32 SDK 30-second baseline generated 335, 194 and 82 tokens. Its last 28.78475-second input span already had incomplete content in the raw generated hypothesis. Stripping protocol metadata from the raw text produced the same text returned by SDK parsing. Direct inference through the same registered core produced identical generated IDs for all three spans. This rules out SDK text parsing and aiditor's assembly as the cause of those reproduced omissions.

Native Transformers 5.22.1 also ended its 30-second spans at EOS below the cap and still omitted later material. Ten-second spans improved ending coverage in both implementations. The remaining issue is recognition/generation behavior that is sensitive to input duration and implementation; it is not an exhausted token budget or CSV clipping in these tests. Raising the cap is unsupported by the evidence and was not attempted.

Each Srota result JSON contains input start/end/duration, actual generated IDs and counts, EOS/limit flags and stopping reason, raw text with and without special tokens, text after parsing, and the final assembled transcript. The generation observer returns native results unchanged. These input intervals are not invented speech timestamps.

## BF16 and INT8 feasibility

PyTorch reported AVX512 capability but `avx512_bf16=false` and `amx=false`. BF16 inference was skipped in accordance with the native-support requirement; no speed, memory or accuracy advantage is claimed on this machine.

The published TorchAO 0.18.0 distribution had no Windows wheel. The compatible installed alternative, PyTorch dynamic INT8, was tested in isolated processes. Broad quantization converted 308 Linear modules. A second trial quantized only 196 decoder Linear modules, preserving the audio encoder and output head in FP32. Both degraded recognition significantly; one broad-INT8 27.1-second span yielded the malformed text `ressed system`. Neither configuration is recommended. Peak cold-process RAM also did not improve usefully: broad INT8 peaked at 6.06 GB, decoder-only at 5.34 GB. No quantized Srota checkpoint was installed or saved over the original. The tested legacy PyTorch quantization API is deprecated, another reason not to turn this feasibility test into a production dependency.

## Direct Transformers compatibility and conversion

The SDK environment's Transformers 4.57.6 lacks `AutoModelForMultimodalLM`. An isolated overlay containing Transformers 5.22.1, huggingface-hub 1.31.0 and tokenizers 0.23.1 was used; existing environments were not upgraded.

The original legacy checkpoint cannot be handed directly to the native loader: its hidden size is nested under `thinker_config.text_config` and is 1024, while native AutoConfig initially selected a 2048 default. Loading mismatched/random parameters was refused.

Hugging Face's official conversion script was captured with its source hash and license. Its unmodified strict load initially failed because `lm_head.weight` is absent in the fine-tune's safetensors file. The original text configuration explicitly declares tied embeddings and stores the shared `thinker.model.embed_tokens.weight` tensor. The isolated compatibility branch restored only that declared alias from the existing tensor, retained strict loading and preserved the original generation configuration. No random head or learned values were created.

After conversion, all **611 original tensors were compared byte-for-byte** under the official key-name mapping, with zero mismatches. Original and converted stored tensors are BF16; native CPU inference was explicitly FP32. The old failed conversion folder/logs remain separate from the successful `srota-native-hf-tied-alias` copy. One earlier experiment-driver duplicate output-format argument was also corrected before the direct-core comparison; its failed log was retained and is not treated as a model failure.

## Shunya conversion, timestamps and quality

CTranslate2 4.8.4 and faster-whisper 1.2.1 reused already installed libraries. The converter wrote a separate {conv['bytes']/1e6:.2f} MB model folder. Conversion itself took {conv['conversionSec']:.2f} seconds, with 2.78 GB peak RAM; full converter subprocess time included additional imports. Supported CPU compute types were float32, int16, int8 and int8_float32. Runtime compute type was verified as int8_float32.

The original tokenizer and preprocessor are byte-identical to the converted copies. The checkpoint's six native alignment heads were preserved. Both INT8 trials completed and retained mixed Devanagari/Latin output. The timestamp trial returned 280 words with finite ordered-within-word intervals inside the recording bounds, ending at 83.66 seconds; no external aligner or synthetic word timing was used.

Shunya PyTorch completed in 838.85 seconds inference with 5.48 GB peak RAM. CTranslate2 without timestamps took 293.21 seconds and 2.69 GB; with timestamps it took 240.16 seconds and 2.69 GB. The observed improvement is approximately 2.9–3.5×, with roughly half the peak RAM. These are end-to-end runtime comparisons, not a pure quantization microbenchmark: Transformers uses overlapping windows and faster-whisper uses its own seeking/segmentation. Word alignment can change seeking and output; the faster timestamp trial does not prove alignment itself makes computation faster.

The existing Windows MKLDNN workaround remained active for the original PyTorch trial. It completed without a native crash but required about fourteen minutes for this recording. That demonstrates genuine slow execution in this trial, rather than an application timeout or deadlock. Earlier native-crash evidence remains a separate compatibility issue.

## Output and English-recognition comparison

The user chose output/coverage review rather than providing a manually verified transcript. No WER or accuracy percentage is reported, and character counts are not used as accuracy scores.

- All accepted FP32/INT8-Whisper trials retained native mixed script; English terms were not automatically Romanized or corrected.
- SDK Srota with 30-second spans omitted the closing Lego/Blinkit material. Short spans restored it, but still skipped some phrases represented in both other recognizers and produced name/spelling errors. Native Transformers alone did not eliminate these issues.
- The opening number differed: SDK 30-second Srota said 50; SDK short windows and native Transformers said 25. These are observable differences, not a certified accuracy score.
- Srota short windows rendered keychain phonetically as `कीचन` and Kinder Joy as `kinda जो` in one span. Bigger model size did not guarantee correct English product names.
- Shunya CTranslate2 with timestamps retained Latin forms such as `harry potter`, `Gems`, `lego set` and `video`, but rendered Blinkit phonetically as `ब्लिंक किट` and made Hindi/spelling errors. Shruti also has known English recognition errors. Full native text files are supplied for manual review.
- Shunya and Shruti reached the closing section; reaching the ending still does not prove recognition of every interior word.

## Integrity, reproducibility and scope

Original Srota and Shunya checkpoint hashes still match the pre-study values. All 24 pinned source model assets (12 per model) passed their original checksums. Forty-eight existing ASR/UI/Tauri/dependency files matched the prior source snapshot. Shunya conversion integrity and native Srota tensor integrity have separate evidence JSON files. Two generation-audit unit tests passed.

New code is confined to `speech-lab/experiments/`; model derivatives, package overlays, results and logs are confined to managed Audio Lab experiment storage. No production captions, ProjectState, timeline commands, existing model registrations, checkpoints, tokenizers or application defaults were changed. No paid API, GPU execution or cloud transcription was used. None of these configurations has been promoted.

Reproduction entry points are `cpu_hinglish.py`, `run_cpu_study.py`, `run_cpu_followups.py`, and the saved per-case configurations/logs. The two final native runs and alias-preserving conversion also have explicit status/result files. Read the experiment README before rerunning: conversion outputs intentionally refuse overwrite.

## References

- Srota author model card: https://huggingface.co/moorlee/qwen3-asr-0.6b-hinglish
- Native Qwen3 ASR interface: https://huggingface.co/docs/transformers/en/model_doc/qwen3_asr
- Official native-format converter: https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen3_asr/convert_qwen3_asr_to_hf.py (captured blob/hash in native-converter-provenance.json)
- Shunya author model card: https://huggingface.co/shunyalabs/zero-stt-hinglish
- CTranslate2 quantization/support probing: https://opennmt.net/CTranslate2/quantization.html
- PyTorch quantization APIs: https://docs.pytorch.org/docs/main/quantization
'''
    (OUTPUT/'REPORT.md').write_text(text,encoding='utf-8')
    print(OUTPUT/'REPORT.md')
