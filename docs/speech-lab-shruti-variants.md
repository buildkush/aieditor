> Historical experiment report. On 2026-11-06 Shruti 3.2.10 was consolidated into the canonical `shruti` profile. The two experimental profiles and their installation/inference code have been removed. The report below records the prior experiment, not current installation instructions. See `speech-lab-shruti-default.md` for the current setup.

# Experimental Shruti comparisons in Audio Lab

The production Shruti adapter, baseline checkpoint, baseline runtime and model registry are unchanged. These profiles appear only in the Lab catalog and run in separate Python child processes. Neither installation nor opening the Lab initializes a model or transcribes audio.

## Manual use

1. Open Audio Lab and import audio or video.
2. Under Model installation, click **Install experimental profile** for each new Shruti profile. This downloads verified files and creates separate Python environments. It does not load a model or run inference. Unsupported dependency/platform combinations are reported as installation errors.
3. Click the existing model cards to select **Shruti**, **Shruti – Cactus Needle 3.2.10**, and **Shruti – FP32**. Up to three models may be selected; deselect a model to choose another. The same cards contain installation controls; clicking those controls does not change selection. There are no duplicate selectors, numbered dropdowns or special “run all” mode.
4. Click **Run**. Selected models run sequentially against the same prepared audio path and hash. Compare raw transcripts, loading/processing time, peak RAM, runtime versions and native timestamp availability. Audio playback remains available. Each result can be copied or exported independently; the benchmark export includes the latest run batch.

The new environments and weights are installed under `%LOCALAPPDATA%/com.aiditor.app/speech-lab/experimental-runtimes/<profile>` and `experimental-models/<profile>`. FP32 uses the shorter runtime path `speech-lab/r/fp32` to keep Orbax dependency files within Windows path limits. The existing baseline environment is never upgraded. Completed installations are used offline; inference never installs or downloads assets.

## Cactus Needle 3.2.10 inspection

The installed baseline package is `cactus-needle==3.2.9`. Its package files match the published 3.2.9 wheel. Comparing the complete `needle/` package trees in the 3.2.9 and 3.2.10 wheels finds one changed file: `needle/__init__.py`, where `__version__` changes from `3.2.9` to `3.2.10`. Whistle transcription, fetching, architecture, checkpoint loading and tokenizer code are byte-identical. Distribution metadata has the corresponding version/record changes.

- [Published 3.2.10 package and provenance](https://pypi.org/project/cactus-needle/3.2.10/)
- Wheel SHA-256: `e584274185c77ba679aa3ac522344d91c27ff367b6d500357264c2292708139e`.
- The wheel is pure Python; the native library is published separately. Both packages select Needle **3.3.3** for generation 3; the baseline already uses it. There is no different native engine in the new package.
- On this Windows x64 host, the isolated profile uses a verified copy of `libneedle3.dll`, 1,533,952 bytes, SHA-256 `1263c6003dd88b9fcb1904a55985be66858639849309280b42f7764ee5d874d0`, from the baseline's pinned native wheel. Its complete platform-specific manifest remains in `shruti-assets.json`.
- Supported public API: `needle.Whistle(weights).transcribe(audio, language=None, keywords=None, word_timestamps=False)`. The experiment uses automatic language detection, shared keywords and word timestamps. It preserves the original response. No inference difference is promised by the version change alone.

## Original FP32 checkpoint

Source: [udgamlabs/Shruti](https://huggingface.co/udgamlabs/Shruti), pinned revision `0b04196e1df3e32edc233df2ea3385873f2356a6`. The model card identifies the safetensors file as full-precision weights with embedded configuration. The separate repository `config.json` describes the Cactus deployment file, not a Transformers architecture.

- Original `shruti.safetensors`: 222,101,212 bytes; SHA-256 `5c43105db153a47d02c47131d37d066343f04f1c3ff82315ff5da1ce264fbfa7`.
- Its header contains 116 `F32` tensors, a 512-dimensional Whistle architecture with eight encoder and eight decoder layers, 8,906 text tokens and eight language tags including Hindi. The 714 additional Hindi token pieces and their order come from its embedded `run` metadata.
- CPU implementation: upstream `needle.model.whistle.Whistle` and `load_whistle`, using JAX/Flax in float32. It reconstructs the upstream tokenizer-extension recipe with a separately pinned 8,192-piece SentencePiece base tokenizer. It checks vocabulary size, language order, special token IDs, exact checkpoint tensor names/shapes/dtypes and expected architecture shapes. Missing/mismatched weights cause an explicit error. There is no checkpoint conversion, random-weight fallback or substitute recognizer.
- The greedy decoder follows upstream Whistle's language-tag-first scorer, with `quant=False` throughout. It processes pause-aware input chunks of at most 30 seconds. Raw per-chunk text, token IDs, language and EOS status are retained. Context-limit hits produce warnings. This is a separate experimental decoder and may produce different results or be substantially slower than the native engine.
- This decoder has **no native word timestamps or keyword-biasing implementation**. Hints are explicitly reported as unapplied. Input chunk ranges are not presented as word timings. FP32 exports TXT/JSON, not fabricated subtitles.
- Native model loading and execution compatibility are checked only when the user clicks Run. Initial JAX compilation is included in inference time. Runtime dependencies are pinned in `shruti-variants-assets.json`; pip or runtime compatibility failures are surfaced without substitution.

## Validation performed

Static package comparison, remote checkpoint header/configuration inspection, syntax checks, mocked setup/catalog tests, mocked sequential-worker service tests, static UI rendering checks and frontend type/build checks. No model was initialized, no audio was transcribed, and no benchmark or inference test was run. New model files/environments are not installed automatically; use the explicit installation buttons before the manual comparison.

The original checkpoint and baseline assets use Apache-2.0 according to their publishers. Copies of the inspected package wheels and metadata are under `speech-lab/research/shruti-variants` for reproducibility; they are not bundled as inference dependencies.


Installation errors include the original pip error and the persistent `install.log` path. The FP32 installer reuses already verified model and tokenizer downloads when repairing a failed environment. No global Python packages or Windows execution/long-path policies are modified.


FP32 pins `orbax-checkpoint==0.11.30`, which satisfies Flax's declared dependency and does not ship the deeply nested compatibility-test fixtures in Orbax 0.12.9. Those fixtures exceed Windows MAX_PATH even in a shortened venv. Orbax is a Flax dependency; Shruti loads its original safetensors through Needle's safetensors loader, not Orbax checkpoint APIs.
