# Shruti in Speech Lab

Implemented 2 November 2026. Shruti is an experimental development-only backend, alongside Whisper Small and Large-v3-Turbo. It uses the existing Speech Lab UI, Tauri commands, Python worker, NDJSON events, cancellation, model cache and PyAV audio preparation. ProjectState, timeline commands, production captions and editor workflows are unchanged.

Subsequent feature: [Generate Auto Captions](auto-captions.md) reuses this backend from the project File menu through scoped caption RPCs, with review and command-based Caption import. Speech Lab itself remains development-only; the original isolation/production validation statements below describe the initial Speech Lab integration.

## Install and manually transcribe

1. From `C:\kushagra\aiditor`, run `powershell -File scripts/setup-speech-lab.ps1`. This updates the existing development Python environment using pinned requirements. On the development machine used for this integration, the dependency and model are already installed.
2. Start/restart `npm run tauri dev` after the Rust cancellation change. Open **Developer · Speech Lab**, or press **Ctrl+Shift+L**.
3. Choose **Shruti · Experimental**. Click **Download** if needed. Installation downloads and verifies the model plus the platform's native engine, loads the model without transcribing, then marks it installed. Interrupted downloads resume; failed installations remain retryable; **Verify / repair** reuses valid files.
4. Browse/drop your own audio/video as usual. Optionally enter comma/newline-separated keyword hints (names or phrases). Click **Transcribe**. Shruti always receives automatic language detection; Whisper's language/device/VAD settings are retained for Whisper and are not applied to Shruti.
5. Inspect **Native Shruti output** and **Word timestamps**. Optionally enable **Roman Hindi · keep English unchanged** to see an editable version with Hindi in English letters, while existing English words retain their spelling and case. This also applies to comparison cards. **Export JSON** retains the native response and includes the optional Roman text separately. Cancel stops the existing worker process tree. The **Run both Whisper models** button continues to run only Whisper; it does not automatically run Shruti.

No audio testing or recognition benchmarking was performed for this integration. Testing recordings is intentionally left to the user.

## Dependencies and assets

- Added **`cactus-needle==3.2.9`** to the existing requirements and lock. Its only base dependency, `huggingface_hub`, was already satisfied by the locked environment. Installation changed no existing dependency versions, and `pip check` passed. No second environment was necessary. No training, microphone, resampling, JAX, PyTorch or original Whistle model dependencies/weights were installed.
- Model: **`udgamlabs/Shruti`**, revision **`ebf52e614065ce20e56affdab641f749a04511a5`**, **`shruti.cact`**, **29,546,527 bytes**. SHA-256 **`b189e954aaed4a9fd41acbad3ac05e486381e96325b22a4c695b9ea5153d7065`** agrees with the official Shruti 1.0 checksums and Hugging Face LFS metadata. `shruti.safetensors` is never requested.
- Native engine: **Needle 3.3.3**, from **`Cactus-Compute/needle3`**, revision **`d6c7d6a2e9655505e0f8e23339356dd1705900eb`**. `shruti-assets.json` pins platform wheel sizes/hashes from the official repository and the library's hash derived from each verified wheel. Only the known shared library is extracted. The Windows x64 archive is 700,859 bytes; the extracted DLL is 1,533,952 bytes. Combined download size on this machine is **30,247,386 bytes**.
- Model and engine are Apache-2.0. See [Shruti's license and notice](https://huggingface.co/udgamlabs/Shruti/tree/ebf52e614065ce20e56affdab641f749a04511a5) and the [Needle engine repository](https://huggingface.co/Cactus-Compute/needle3/tree/d6c7d6a2e9655505e0f8e23339356dd1705900eb).

Storage uses the existing app-local Speech Lab cache:

```text
C:\Users\Kushagra Singh\AppData\Local\com.aiditor.app\speech-lab\models\shruti\
  shruti.cact
  needle-engine.whl
  libneedle3.dll
  manifest.json
  installed.json
```

Other supported platform manifests use the corresponding `.so` or `.dylib`. Only Windows x64 loading was exercised. Model, archive and extracted-library hashes are rechecked for Shruti cache reuse. Remove deletes only Shruti's model folder. Python remains in the ignored `.speech-lab-venv`; no runtime binaries or weights are added to installer resources.

## Runtime and response contract

The adapter calls the public API from the pinned package:

```python
from needle import Whistle
model = Whistle(local_shruti_cact)
response = model.transcribe(prepared_wav, word_timestamps=True, keywords=keywords_or_none)
```

`prepared_wav` is the existing cached mono 16 kHz WAV. No new media decoder or resampler is added. `language` is omitted. Before importing Needle, `NEEDLE_TELEMETRY=0`, `HF_HUB_DISABLE_TELEMETRY=1`, `HF_HUB_OFFLINE=1` and the upstream-supported `NEEDLE3_LIB_PATH` override select the explicitly installed local engine. Runtime/model installation is an explicit network operation; inference does not trigger asset downloads or upload audio.

The pinned package's public `Whistle.transcribe` docstring and `show_transcript` implementation were inspected. The response is a dictionary containing `text`, `language`, `ttft_ms`, `decode_tps` and optionally `words`; word entries contain `word`, `start`, `end`, `probability`. It does not return subtitle segment boundaries or a language confidence. The normalized result therefore adds `text`, top-level `words` and `rawResponse`, leaves `segments` empty and `languageProbability` null, and keeps unavailable word times null. Invalid times cause an error rather than guessed alignment. Unknown fields remain in `rawResponse`.

The native Shruti text is displayed/exported exactly as returned, including script, spelling, punctuation, case, whitespace and line breaks. It bypasses whitespace joining, corrections and rewriting. At the user's request, an optional Roman Hindi view now uses the existing local converter to write Hindi in English letters while leaving literal English unchanged. This view is off by default, supports independent edits per run, and never modifies native text, raw response, word times or WER. JSON preserves the complete native response, normalized word times and measured processing metadata; `romanHindiExperiment` contains the separate displayed Roman text when enabled, otherwise null. There are no synthesized SRT/VTT segment boundaries. Whisper keeps its existing segment editing, Roman Hindi and subtitle exports.

## Files changed

- `speech-lab/backend/shruti-assets.json`: pinned model/engine manifest and checksums.
- `speech-lab/backend/shruti_runtime.py`: platform selection, dependency checks, verified engine extraction, offline public constructor.
- `speech-lab/backend/shruti_transcription.py`: prepared-WAV inference adapter, keyword validation, native response normalization and metrics.
- `speech-lab/backend/models.py`, `worker.py`: reuse existing install/cache and NDJSON routing for Shruti; initialization-only action.
- `speech-lab/requirements.txt`, `requirements-lock.txt`, `scripts/setup-speech-lab.ps1`: dependency pin and setup guidance.
- `src/speech-lab/types.ts`, `services/evaluation.ts`, `ui/SpeechLab.tsx`: experimental model card, optional keywords, native output/word-time handling, guarded JSON export. No changes to the Roman Hindi converter or Whisper transcription settings.
- `src-tauri/src/speech_lab.rs`: terminate the owned Windows worker process tree, including the venv launcher's Python child, with a hidden process and no new Rust dependency.
- `speech-lab/tests/test_shruti.py`, Speech Lab evaluation/service/UI tests, and the Rust process-tree test: mocked integration and lifecycle coverage.
- This document and the existing Speech Lab report link.

## Validation

- Actual dependency installation and `pip check` passed.
- Actual pinned model/engine download, checksum verification and `Whistle(local_path)` initialization passed on Windows x64.
- Actual cached verification/reuse and public initialization passed with Python socket connections and HTTP requests blocked. No transcription was invoked during this check.
- Mock tests cover native mixed-script text, complete raw JSON, missing/invalid timestamps, absent language confidence, keyword serialization, automatic language choice, prepared WAV routing, NDJSON worker results, progress/errors, resumable downloads, corrupt model/DLL repair, failed-load retries and isolated removal.
- UI/service tests verify optional Roman text is separate from the native response, English spelling/case is preserved, comparison cards support it, and Whisper retains its existing behavior.
- The Rust cancellation test spawns only inert sleeping Python processes and confirms cancellation kills descendants. It opens no audio and loads no models.
- **22 frontend/service tests**, **19 Python tests**, **1 Rust cancellation test**, the **production frontend build** and **`cargo check`** passed. Production assets contain no Speech Lab/Shruti UI or runtime code. The build retains its existing large-chunk advisory. Other OS loading and real-audio transcription/accuracy/performance are intentionally untested.

Sources: [official Shruti repository](https://github.com/udgamlabs/shruti), [Python example](https://github.com/udgamlabs/shruti/blob/main/examples/transcribe.py), [official checksums](https://github.com/udgamlabs/shruti/blob/main/SHA256SUMS), [model card](https://huggingface.co/udgamlabs/Shruti), [cactus-needle 3.2.9](https://pypi.org/project/cactus-needle/3.2.9/). The linked technical report was not retrievable through the web tool; integration details were verified against the official repository, pinned package source and model/engine repositories.
