# CPU Hinglish experiments

## User-verified multi-recording adaptation (2026-11-07)

`shruti_verified_data.py` preserves the supplied transcript and derives conservative input-clip cuts from exact agreement anchors in existing native word timings. It verifies the PCM WAV hash and records that these cuts are not manually verified word alignments. The Harry Potter 25 upload is a duplicate of the previous 83.68475-second recording and is counted once.

The multi-recording pilot trains on Harry Potter 25 and Kinder Joy with public replay. The complete LEGO recording, including its long ASMR gap, selects checkpoints through native recognition; teacher-forced labels are not stretched over that gap. Golden Can is locked before training and is used only after checkpoint selection. Its supplied words, number formatting and incomplete final phrase remain unchanged. A frozen training-script snapshot and a selection lock are retained in the experiment cache.

The completed four-pass/192-update run selected epoch 2. LEGO validation improved from31 to28 normalized word errors, but the held-out Golden Can result stayed21/99 and the public regression set rose65 to66. The candidate was not promoted. `summarize_shruti_multi.py` preserves scope-separated metrics, raw references/predictions, source and production checksums, and formatting caveats. Outputs are under `%LOCALAPPDATA%/com.aiditor.app/speech-lab/adaptation/shruti-multi-2026-11-07`. Model size remains29.5MB; individual wall-time measurements are not a controlled speed benchmark.

## Shruti weight-adaptation pilot (2026-11-06)

`shruti_public_data.py` downloads a bounded, labelled MUCS subset with speaker-ID, recording, transcript and PCM disjoint splits. It retains the original CC BY-SA 4.0 provenance and notes Shruti's existing exposure to MUCS training data. Metadata requests are paced and rate-limit responses are respected.

`shruti_adapt.py` preserves Shruti's 714 Hindi token pieces and language IDs, exports an unchanged reference for hash verification, trains decoder-only rank-4 LoRA with 4-bit/8-bit quantization-aware numerics, and exports an isolated native candidate. The encoder, architecture and vocabulary size do not change. It requires a separate JAX/Flax training environment; it is never imported by production code. `summarize_shruti_adapt.py` compares saved native outputs and verifies that the production checkpoint remains unchanged.

The completed pilot used 24 train, 8 validation and 16 test clips. It did not improve validation loss or English-subsequence error rate and added one overall test word error, so the candidate was rejected for promotion. Outputs, provenance and the report are under `%LOCALAPPDATA%/com.aiditor.app/speech-lab/adaptation/shruti-2026-11-06`. The native candidate is diagnostic, not an approved replacement. Stock `needle whistle build` must not be used on its adapter without preserving the original Shruti tokenizer; see the saved adapter provenance.

## Earlier CPU study

These scripts are explicit Audio Lab experiments. They are not imported by the editor, model registry or production caption workers. The user authorized inference on the existing 83.68475-second reference recording for this study.

`cpu_hinglish.py` loads the existing prepared PCM read-only, verifies its SHA-256 and sample count, and runs an isolated configuration. Srota records actual generated IDs/counts, EOS versus token-budget termination, text before SDK parsing, text after parsing, each input interval and the final transcript. The generation observer returns the native output without changing generation arguments. `max_new_tokens` remains 1024. BF16 is refused unless the native CPU capability probe succeeds; CPU FP16 is not used.

`run_cpu_study.py` runs models serially to avoid competing CPU inference jobs. It records each subprocess wall time and exit status, captures logs, and checks original checkpoint hashes before and after the study. Its 900-second per-case watchdog is an experiment safeguard only; it does not alter the editor's ASR timeout behavior. Results are written beneath `%LOCALAPPDATA%\com.aiditor.app\speech-lab\experiments\`.

The study covers five thread counts, explicit/default attention, SDK/direct decoding, a separately installed native Transformers overlay, dynamic CPU INT8 feasibility, Shunya CTranslate2 INT8 conversion, converted inference with/without word timestamps, and the original PyTorch path. Check individual result status: a compatibility failure is not a successful inference measurement.

The native Transformers interface is tested separately because the existing SDK runtime has Transformers 4.57.6, which lacks AutoModelForMultimodalLM. The overlay lives only in the experiment directory. Loading is rejected if the native configuration does not match the legacy checkpoint's architecture; incomplete or randomly initialized weights must never be benchmarked as the original Srota model.

The completed native-format test uses the captured official converter and a separate `srota-native-hf-tied-alias` output. `--restore-tied-alias` is a narrowly guarded compatibility branch: the source configuration must explicitly declare tied embeddings, the shared embedding tensor must exist, and the omitted output-head key must be absent. It supplies that existing tensor as the declared alias and still requires strict state loading. All 611 original tensor byte sequences were verified against the converted file. The source generation configuration is copied unchanged; inference still requests a 1024-token maximum and FP32 on CPU.

Read `REPORT.md`, the comparison CSV and individual result JSON in the managed experiment directory for actual outcomes. Failed driver/compatibility attempts remain in the evidence; only successful complete runs are used for performance recommendations. The final native runs are identified by `srota-direct-native-tied-hf-t4` and `srota-direct-native-short10-t2`. Generic CLI defaults such as thread/attention fields are not overrides for Shruti; that baseline uses its existing engine-managed configuration.

Shunya conversion reuses installed conversion/runtime libraries read-only and writes a separate `shunya-ct2-int8` folder. It refuses to overwrite that folder. The original checkpoint and tokenizer are preserved. CTranslate2 CPU compute types are probed before conversion and inference. The converted run uses greedy beam size 1, matching the original model's default beam count, language auto-detection, transcription task, no VAD, and independent decoding windows. These settings are recorded for comparison rather than promoted into production.

Run the small generation-audit tests without model inference:

```powershell
.speech-lab-venv/Scripts/python.exe -B -m unittest discover -s speech-lab/experiments -p 'test_*.py' -q
```

Timing comparisons are exploratory single-machine trials. Model load and total subprocess wall time are separate from inference time. CPU utilization is a headroom measure, not a direct editor-interaction latency test. A manual reference transcript is required for trustworthy WER/accuracy scoring; transcript length or agreement with another ASR hypothesis is not ground truth. Review the saved complete transcripts and chunk-level evidence before accepting a configuration.
