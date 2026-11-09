# Speech Lab — implementation and evaluation report

Built and tested on 1 November 2026. This is an isolated development environment for evaluating local recognition, not the production Caption Generator.

Update, 7 November: [Tara accuracy experiment](speech-lab-tara.md) adds the original
Trelis Tara checkpoint with isolated CPU FP32 inference and its official mixed-code
prefix. It is optional in Audio Lab; Shruti remains the default and production
caption recognizer. The benchmarks below remain historical.

Update, 2 November: [Shruti integration, installation and validation](speech-lab-shruti.md) documents the added experimental native Hindi/English backend. The Whisper benchmarks below remain historical; no Shruti audio benchmarking was performed.

[Generate Auto Captions](auto-captions.md) now reuses the local backend from the project File menu, with independent output-script selection, timed review and EditorCommand-based import. Standalone Speech Lab access remains development-only.

## Open and set up

Run `powershell -File scripts/setup-speech-lab.ps1` from the repository, then `npm run tauri dev`. Python 3.13 on Windows is the tested runtime; the locked dependencies require Python 3.12 or newer. Setup creates `.speech-lab-venv` inside the repository, excluded from version control and packaging. `AIDITOR_SPEECH_PYTHON` can point to another compatible interpreter.

Use **Developer · Speech Lab** on the development welcome screen, **Ctrl+Shift+L** in the development app, or the `#/speech-lab` route. The route requires Tauri for processing; opening it in an ordinary browser shows a desktop-runtime message. Back to editor preserves the `ProjectStore` held by `App`. Lab runs and manual corrections are session-only; export them before closing the lab.

## 1. Architecture and isolation

`src/speech-lab/types.ts` defines the reusable audio, transcript, word, options and benchmark contracts. `services/whisperService.ts` is the React-independent Tauri client. Evaluation/export and Roman Hindi conversion are separate modules. `ui/SpeechLab.tsx` presents models, settings, playback, results and comparisons.

`src-tauri/src/speech_lab.rs` launches a Python child for each request and forwards NDJSON progress/results through job-scoped Tauri events. Pipes are drained on background threads. Only one worker operation runs at a time, so deletion, downloads and inference cannot race. Cancellation terminates the matching process, including native model-loading/decoding calls. Crashes without a terminal response are surfaced with bounded stderr diagnostics. Closing the main window kills outstanding children.

`speech-lab/backend` separates audio preparation, model management, hardware/metrics and transcription. There is no HTTP transcription server, second Tauri application, `ProjectState` change, caption insertion, timeline operation or alternate editing state. Audio timestamps remain relative to the prepared audio.

## 2. faster-whisper integration

Tested stack: faster-whisper **1.2.1**, CTranslate2 **4.8.4**, PyAV **19.0.2**, Python **3.13.7**, psutil **7.2.2**. Exact transitive versions are in `speech-lab/requirements-lock.txt`; setup uses that lock. `requirements.txt` describes the direct runtime dependencies.

The existing editor has browser-based media decoding, but no FFmpeg process/extraction service. The lab therefore uses PyAV's FFmpeg libraries to decode the first audio stream and stream-resample it into cached **mono, 16 kHz, signed 16-bit WAV**. Video is not re-encoded or changed. Playback uses that prepared audio, allowing codecs unsupported by WebView2's native media decoder to be evaluated too.

The prepared PCM is passed to `WhisperModel.transcribe` as floating-point samples with `task='transcribe'`, `word_timestamps=True`, the optional language hint and configurable VAD silence duration. Turbo decoding uses **10-second windows** and `condition_on_previous_text=False`. Small retains its existing **30-second windows** and previous-text context; the truncation fix is specific to Turbo. faster-whisper retains responsibility for seeking, word alignment and restoring VAD timestamps; the lab does not invent word timings. Window size, context policy and duration after VAD are recorded in processing metadata. It is never translated. This also avoids a real compatibility issue found during testing: faster-whisper's filename decoder passes the removed `metadata_errors` argument to current PyAV. The lab does not patch either library or decode twice.

## 3. Models, sizes and storage

The two Whisper backends use multilingual CTranslate2 models. Repositories match [faster-whisper's model map](https://github.com/SYSTRAN/faster-whisper/blob/master/faster_whisper/utils.py). The separately documented Shruti backend uses `shruti.cact` with Cactus Needle.

| Model | Repository | Manifest download bytes measured |
|---|---|---:|
| Whisper Small | `Systran/faster-whisper-small` | 486,212,372 (~486 MB) |
| Whisper Large-v3-Turbo | `mobiuslabsgmbh/faster-whisper-large-v3-turbo` | 1,621,665,983 (~1.62 GB) |

These are observations from the fetched manifests, not constants in the interface. The UI fetches current metadata on demand and retains it for offline status. Downloads pin the repository commit, restrict downloaded filenames, resume `.part` files with HTTP Range, validate sizes and available SHA-256 checksums, then atomically mark the complete model installed. A checksum failure invalidates an earlier installed marker even if a repair is interrupted. Repair and removal are available in the model cards. Removing models is restricted to the known model directories.

The Tauri application-local-data directory owns `speech-lab/models`, `speech-lab/audio` and `speech-lab/inputs`. On this laptop it is:

```text
C:\Users\Kushagra Singh\AppData\Local\com.aiditor.app\speech-lab
```

`audio` contains reusable prepared WAV files and metadata keyed by input path/size/mtime; the prepared audio SHA-256 is stored in each result. `inputs` contains chunked copies of drag-and-drop media. Original sources are read-only. Clear results clears the lab's in-memory results, not media caches or downloaded models. The model Remove action removes that model's local files.

After installation, transcription uses local model paths with `local_files_only=True` and Hugging Face offline mode. Hugging Face telemetry and ONNX Runtime telemetry are disabled. An actual inference run succeeded with Python network connections explicitly blocked.

## 4. CPU/GPU behavior

CTranslate2 detects CUDA devices and supported compute types. Auto prefers CUDA when available, with FP16 when supported; otherwise it selects an available GPU compute type. CPU prefers INT8, with float32 fallback on unsupported CPUs. A GPU preference on a machine without CUDA falls back to CPU with an explicit reason. Recoverable GPU loading/inference failures retry on CPU. Out-of-memory errors produce guidance to try Small/CPU or close applications.

GPU support depends on a compatible NVIDIA GPU and the CUDA/cuDNN libraries required by the installed CTranslate2 build. The current faster-whisper installation notes specify CUDA 12 and cuDNN 9; see the [upstream requirements](https://github.com/SYSTRAN/faster-whisper#gpu). No CUDA libraries, GPU drivers or extra recognition providers are installed by the setup script.

This machine has an **Intel i7-1165G7, 8 logical CPUs, 16 GiB RAM and Intel Iris Xe**, with **no CUDA device**. Inference uses up to **4 CPU threads** to leave capacity for the UI. Actual GPU/FP16 execution could not be tested. A CUDA request was tested on the MP4 fixture and correctly fell back to CPU INT8.

## 5. Actual recognition and benchmark results

The JSON evidence is in `docs/speech-lab-benchmarks.json`, including original segments, word timestamps, probabilities, references and measurements. Recordings and individual raw run files are in the ignored `speech-lab/test-output` folder. No sample audio or model weights are bundled with the app.

Sources:

- English: a locally generated Microsoft SAPI recording of a known 17-word sentence, **8.103 seconds**. This is synthetic speech and is not evidence of conversational accuracy.
- Hindi: natural speech from [Google FLEURS](https://huggingface.co/datasets/google/fleurs), `data/hi_in/audio/test.tar.gz`, member `test/10011266027513218401.wav`, **9.120 seconds**. Reference comes from the corresponding test TSV.
- Hinglish: natural code-switched tutorial speech from [MUCS-Hinglish](https://huggingface.co/datasets/dianavdavidson/MUCS-Hinglish), test row 0, segment `103085_w5Jyq3XMbb3WwiKQ_0000`, **8.275 seconds**. The dataset reference contains Devanagari Hindi and literal English words.

Dataset references were not independently human-verified. WER below is a reproducible, case/punctuation-normalized, whitespace-tokenized comparison against those references. It penalizes spelling and script differences; it is not a semantic accuracy score. WER can exceed 100% because of insertions.

| Recording / hint | Model | Output language | Processing seconds | Real-time factor | Peak RAM (MB) | WER |
|---|---|---|---:|---:|---:|---:|
| English / auto | Small | en | 6.72 | 0.829 | 733 | 0.0% |
| English / auto | Turbo | en | 26.86 | 3.315 | 1,976 | 0.0% |
| Hindi / auto | Small | hi | 12.20 | 1.338 | 736 | 50.0% |
| Hindi / auto | Turbo | hi | 30.69 | 3.365 | 1,976 | 37.5% |
| Hinglish / auto | Small | ur | 8.98 | 1.085 | 733 | 110.5% |
| Hinglish / auto | Turbo | ur | 29.22 | 3.531 | 1,976 | 105.3% |
| Hinglish / Hindi | Small | hi (hinted) | 9.67 | 1.168 | 733 | 57.9% |
| Hinglish / Hindi | Turbo | hi (hinted) | 19.00 | 2.296 | 1,976 | 42.1% |

These are short, cold-worker runs, not a statistically adequate model ranking. Subsequent desktop runs varied (approximately 8.6 s and 17.5 s for Hinglish with Hindi), as expected from OS file caching and machine load. No overall accuracy winner is claimed.

## 6. Word timestamps and editing

The English runs returned **17 actual model words** each. Hindi returned 25/24 words and Hindi-hinted Hinglish returned 20/19 words for Small/Turbo. Words retain their model text, punctuation, start/end times and probabilities; segments additionally retain average log probability and no-speech probability. There is no equal-duration timing synthesis and no call into the editor's caption timing code.

Word times are estimates derived by Whisper, not perfectly accurate or independently verified alignments. VAD remains optional. Clicking a word seeks and plays the prepared source audio; this was exercised in the desktop UI.

Manual corrections are kept separately by segment ID. Original model output remains visible and unmodified, and WER continues to use it. JSON exports contain `original`, `corrections` and corrected segment text; original word times remain under `original`. Corrections do not fabricate or realign word timings. SRT and VTT use the original segment boundaries with the edited segment text. JSON was saved through the native export dialog and verified to retain 19 original model words separately from the corrected text; generated SRT/VTT both round-tripped through the editor's existing subtitle parser.

## 7. Hinglish and Roman Hindi findings

Both models classified this short Hinglish sample as Urdu in automatic mode and produced Arabic-script output. A Hindi hint selected Hindi/Devanagari output, but recognition errors and phonetic English spellings remained. This is a real failure case that merits a larger sample set before production integration.

Hindi selection does not promise Roman Hindi. `services/romanHindi.ts` is a separate, optional deterministic Devanagari-to-Latin conversion. It applies final/internal Hindi schwa deletion, handles long vowels, nukta and conjunct joiners, and uses conventional spellings for common spoken words and English loans. Literal English text is unchanged. It does not translate or affect inference, timestamps or WER, and adds no model or package dependency. Unknown names, ambiguous loanwords and recognition errors still need review. It does not transliterate Urdu output.

**Roman Hindi · keep English unchanged** applies to the selected result and both comparison cards, including Shruti. Each run has a separate editable Roman field and reset action. Overrides are bound to that run's exact corrected source text; changing the segment text regenerates Roman output rather than displaying a stale override. JSON includes the displayed Roman text separately from the original. Whisper SRT/VTT continue to export the editable segment text; Shruti supports JSON. All these edits remain session-only.

### Dense-speech truncation regression

A user-provided 27.283-second Hindi/Hinglish recording reproduced incomplete Turbo output with the former 30-second window. VAD retained 27.171 seconds, ruling out removal of half the audio. Turbo produced only the first half of the spoken content, with its final word starting at 13.67 seconds but ending at 27.25 seconds. Resetting previous-text context alone still reproduced the failure. This was model decoding/alignment prematurely consuming the window, not UI text clipping, audio extraction truncation or Roman conversion.

With 10-second windows, the same installed Turbo weights produced three segments and recovered the second-half content, including the closing availability/check lines. The diagnosis files are local ignored artifacts in `speech-lab/test-output/turbo-diagnosis-{10,30}.json`. This is evidence for this regression, not a guarantee of perfect transcription: word-boundary errors and recognition mistakes remain possible, and shorter windows can cost additional processing time. The benchmark table above predates this window-policy change; its measured results are retained as historical evidence rather than relabeled as new measurements.

Follow-up validation: 18 targeted frontend/service tests, 8 Python tests and the production build passed. The Turbo comparison above completed with both window sizes on the same prepared audio (94 recognized words in three segments with the shorter window). Additional Hindi-hinted Small benchmarks with each window policy ran slowly and were manually cancelled; they are not completed accuracy or performance results. Small's original window/context policy is retained. The opt-in integration harness now accepts `--expect-text` to check known ending phrases and checks word timestamps against segment/audio bounds.

## 8. Metric definitions

- `processingSec`: audio preparation + hardware selection + model loading + inference, excluding Python process startup/import and model downloads.
- `audioPreparationSec`, `modelLoadSec`, `inferenceSec`: separate measured phases. A GPU fallback includes the failed attempt in the total.
- `realTimeFactor`: processing seconds divided by prepared audio seconds. Lower is faster; values above 1 are slower than real time.
- Peak RAM: process working-set samples every 250 ms, plus Windows peak working-set information where available. Short spikes may be missed on platforms without peak counters.
- CPU: process user/system CPU time divided by wall time and logical CPU count, reported as a share of the entire machine.
- GPU utilization and peak VRAM: optional `nvidia-smi` measurements of **device 0 as a whole**, not isolated process measurements. Unavailable is represented by null, not zero or an invented number.

Every run records the selected options, actual device/compute type, prepared audio hash and cold-worker status. New runs also include the pinned model repository/revision, runtime versions and inference thread count. Comparisons in the UI are restricted to matching prepared-audio hashes. Benchmark JSON retains original word output; CSV retains transcript, metrics and WER counts.

## 9. Installer impact

There are no new npm packages or Rust crates. No Python environment, test audio or model weights are added to Tauri resources. The React entry is guarded by `import.meta.env.DEV`; production Vite output was checked to contain no Speech Lab route, model labels, UI CSS or faster-whisper code. Native Speech Lab commands reject non-debug builds.

An installer was not produced, so an exact installer-byte delta is not claimed. The large runtime and weights are development/app-data downloads, not installer payloads. The small native gateway is the only potential native binary contribution.

## 10. Validation and remaining limits

Passed:

- **530 frontend tests in 56 files**, **8 Python backend tests**, production TypeScript/Vite build and `cargo check`.
- Python backend tests: immutable-source WAV preparation, exact sample duration, cache reuse, offline installed status, partial transfers, ignored HTTP Range, SHA failures, interrupted repair invalidation and restricted removal paths.
- Both real multilingual models on CPU INT8 for English, Hindi and Hinglish; automatic language detection and the Hindi hint.
- Actual WAV, MP3, M4A and MP4-with-video decoding; audio durations matched the 8.103-second source.
- GPU preference falling back to CPU, VAD disabled, and network-disabled CPU inference.
- A real Small download resumed from 482,498,326 bytes, fetched the missing tail and passed complete checksum verification in an isolated cache.
- Desktop model status from persisted downloads, native source picker, playback, both-model comparison, responsive cancellation, word seeking, text correction and JSON export.
- The opt-in integration runner completed fresh English inference for both models, recorded pinned model revisions/runtime versions, checked real word bounds/confidence values and verified native-process cancellation.
- Service tests for listener-before-spawn ordering, serialized operations, job-specific cancellation, crash errors and bounded drag/drop import chunks. Evaluation tests cover WER, script differences, timestamp rounding, CSV quoting, SRT/VTT and separate transliteration.

Not established: GPU/FP16 performance, forced real out-of-memory recovery, long-recording/very-large-reference performance, broad accent/noise coverage, multi-GPU behavior, other operating systems, or publication-grade accuracy. The first audio stream is selected; there is no stream picker yet. The audio cache holds a complete WAV and inference loads its PCM into RAM, so very long recordings need further memory testing. Lab results/corrections are not persisted automatically across closing the lab. Browser-only execution intentionally cannot transcribe. Native cross-window drag-and-drop was not manually exercised; its chunk transport is covered by service tests.

Re-run the checks with:

```powershell
npm test -- --maxWorkers=2
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
.\.speech-lab-venv\Scripts\python.exe -m unittest discover -s speech-lab/tests -v
.\.speech-lab-venv\Scripts\python.exe speech-lab/tests/integration.py PATH_TO_AUDIO --storage "$env:LOCALAPPDATA\com.aiditor.app\speech-lab" --language hi
```

The integration runner performs real inference with already-installed models, writes structured results, checks word bounds/confidence ranges and verifies native-process cancellation. It does not download models or upload audio.
