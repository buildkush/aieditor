# Whisper Tiny Hinglish in Speech Lab

Speech Lab supports the original Whisper Tiny Hinglish checkpoint through its author's CTranslate2 export. It emits Roman Hinglish directly; it does not use aiditor's Roman Hindi converter. Production Auto Captions continue to use Shruti.

## Try it

1. Open Speech Lab (`Ctrl+Shift+L` in the development desktop app).
2. Under models, download **Whisper Tiny Hinglish (Roman)** if it is not already installed. Install Shruti as well for comparison. The existing installer reports progress and supports retry/resume.
3. Browse or drop an audio/video recording. Choose Tiny Hinglish as **First model** and Shruti as **Second model**, then click **Run**. Select **None** as the second model to run one model alone.
4. The comparison runs the first selected model followed by the second on the same prepared audio. Both original results remain available in the run selector and Compare view, including processing/memory metrics. Use Words to inspect decoder word timestamps, or export JSON/SRT/VTT.

Shruti retains automatic language detection and its native mixed script. Tiny uses the author's documented English decoding token for Hindi-English audio and emits Roman text. This is a decoder configuration, not translation. Use matching-script references when evaluating WER; comparing Devanagari against Roman spelling directly is not an accuracy comparison.

The comparison does not merge outputs or apply corrections. Cancelling or failing the second model preserves the completed first result. The existing Shruti keyword field applies to Shruti; Tiny receives no invented keyword parameter.

## Artifact and runtime

- Original model: <https://huggingface.co/abhishekgautamm/whisper-tiny-hinglish>
- Author's CTranslate2 export: <https://huggingface.co/abhishekgautamm/whisper-tiny-hinglish-ct2>
- Pinned revision: `80f7adb3f405e6f10395179198275f75e2ce3dfd` (original model, not v2).
- Download: 156,122,806 bytes across six assets; sizes and SHA-256 hashes are pinned in `speech-lab/backend/tiny-hinglish-assets.json`. The author's README is retained alongside the weights.
- Cache: `%LOCALAPPDATA%\com.aiditor.app\speech-lab\models\tiny-hinglish`.
- Reuses installed faster-whisper/CTranslate2 dependencies. No additional runtime or cloud service.
- Local-only loading; CPU uses the existing INT8 configuration, with existing device selection/fallback behavior. Tiny decoding uses `language="en"`, `beam_size=1` and word timestamps. Existing Whisper Small/Turbo decoding settings are preserved.
- The original model card declares MIT. The export card also mentions separate training-data terms and contains inconsistent placeholder license wording; its metadata does not establish a clear separate export license. Consult the linked cards and cached README before redistribution; the manifest records this provenance without asserting a different license.

## Verification

Mocked tests cover pinned installation, offline reuse, checksum corruption/repair, local-only model loading configuration, native Roman text and word timestamp normalization, comparison audio identity, independent engine settings, cancellation and errors. A manual weights-only check loaded the cached checkpoint offline on CPU INT8 without transcription. No real recordings or inference benchmarks were run automatically.
