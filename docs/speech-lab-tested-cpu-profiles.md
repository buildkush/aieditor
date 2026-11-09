# Tested CPU profiles in Audio Lab

The existing Shruti selection and all previous model integrations remain available. Two additional options reuse the verified November 4 CPU-study artifacts:

- **Srota - Native Transformers FP32** (`srota-cpu`): native-format `srota-native-hf-tied-alias`, Transformers 5.22.1 overlay over the isolated Srota PyTorch 2.10.0+cpu environment; FP32 SDPA, two intra-op / one inter-op threads, batch one, unforced language, 1024-token maximum, pause-aware input spans of at most ten seconds. Raw generated text, individual input outputs and the assembled transcript are retained. No word times are generated. Omissions remain possible.
- **Shunya - CTranslate2 INT8** (`shunya-int8`): existing `shunya-ct2-int8`, CTranslate2 4.8.4 / faster-whisper 1.2.1, explicit CPU int8_float32 and four threads, native word timestamps enabled. The study verified the original tokenizer/preprocessor bytes and alignment heads. No conversion is performed during selection or inference.

The files remain under `%LOCALAPPDATA%\com.aiditor.app\speech-lab\experiments\cpu-hinglish-2026-11-04`. Model sizes/checksums are pinned in `speech-lab/backend/tested-cpu-assets.json`; no weights are bundled. Missing/corrupted artifacts disable the profile with an availability message. These local-study profiles do not offer Download/Remove controls that could recreate or delete the original experiment artifacts. No automatic downloads, package upgrades or conversions occur.

## Manual use

Open Speech Lab, import any supported audio/video source, choose a model as First model and None as Second model, then Run. Existing two-model comparisons also work. Alternatively enable **Run all three CPU models sequentially**, then Run: Shruti, native Srota and INT8 Shunya execute in order. The previous default selections are unchanged.

All models use the existing prepared mono 16 kHz audio. The comparison runner checks the prepared path/hash for every result. The Tauri job queue and owned child-process lifetime keep inference sequential and release model memory before the next job. Cancellation terminates the process tree; already completed results remain available.

Results include the full returned transcript, load/inference/processing times and peak process RAM. The comparison view displays all three results responsively with native timestamp availability, copy, TXT/JSON export and playback controls using the same source audio. Use Word timestamps to inspect native returned words. Srota input chunk ranges describe audio coverage and never masquerade as speech or subtitle timestamps. Optional Roman Hindi remains a separate downstream view.

## Implementation and verification

New backend: `tested_cpu.py` and pinned asset metadata. The existing experimental subprocess relay is reused, and the worker/catalog route the new profile IDs without changing Shruti recognition. Frontend model types, result normalization, selection/comparison UI, per-result exports and responsive comparison layout were extended. The Tauri resource map includes only the small new metadata file.

Tests cover three-model sequencing, CPU-specific request settings, prepared-audio identity, missing/corrupt artifacts, isolated offline runtime routing, three-result rendering, honest timestamp labels and per-result exports. A real worker smoke check ran all three routes serially on the same two-second synthetic WAV and verified matching prepared hashes. This check validates loading, communication and result normalization; it does not evaluate recognition accuracy on silence. User recordings were not automatically benchmarked during this integration.

Remaining limits: the two profiles require their existing study artifacts and isolated environment to remain installed. Srota still omits phrases and has no word timestamps. CPU inference can be slow; timings from the study are not latency guarantees. No production auto-caption, ProjectState, timeline or subtitle architecture changes were made.

## Changed files

- `speech-lab/backend/tested_cpu.py`, `tested-cpu-assets.json`: pinned local profiles and CPU inference adapters.
- `speech-lab/backend/experimental_runtime.py`: shared owned-child protocol relay.
- `speech-lab/backend/worker.py`: lab-only catalog and transcription routing. Production caption operations keep the base catalog.
- `src/speech-lab/types.ts`, `services/evaluation.ts`: profile IDs and native text/word normalization.
- `src/speech-lab/services/modelComparison.ts`: sequential selection of up to three models and fixed CPU requests.
- `src/speech-lab/services/whisperService.ts`: refresh lab profile availability after model maintenance.
- `src/speech-lab/ui/SpeechLab.tsx`, `SpeechLab.css`: selections, three-way comparison, copy/export/playback, responsive full transcript display.
- `src/components/captions/TranscriptViews.tsx`: names for the additional native result types; existing Shruti rendering is preserved.
- `src-tauri/tauri.conf.json`: bundle the small asset manifest, without weights.
- `speech-lab/tests/test_tested_cpu.py`, `src/speech-lab/services/modelComparison.test.ts`, `src/speech-lab/ui/SpeechLab.test.tsx`: availability, routing, sequencing and display checks.
- This integration note.

Final checks: 640 frontend tests, 59 backend tests, production build and Rust checks passed. The lab catalog reported all three profiles ready. Real worker smoke tests ran all three sequentially on one generated silence file and returned identical prepared-audio hashes. Visual desktop interaction and accuracy testing on user recordings remain manual.
