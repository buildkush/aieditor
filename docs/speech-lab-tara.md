# Tara accuracy experiment

## Current runnable Tara configuration

Audio Lab offers only **Tara – Speech-aware · Parallel**. This is the default
Tara configuration and is also the production auto-caption default. Production
Quick mode uses Shruti; the Audio Lab comparison interface remains separate.
The single-worker comparison profile, Standard and original FP32 are retired
from selection and worker dispatch; historical results remain readable. Shared
INT8 weights, conversion-source assets and the runtime are reused unchanged.
Install/verify/remove controls now belong to the Parallel card.

Final output policy: when validation/refinement cannot confidently repair an
interval, retain the original usable DTW start/end rather than replacing it
with null. Such words carry `timingNeedsReview: true`, remain seekable in the
word list, and show “Needs review”. JSON preserves this flag and
`retainedNativeTimingIndices` records the fallback in raw alignment diagnostics.
Long or overlapping original intervals are permitted in this review fallback;
they are not presented as corrected. A genuinely absent/invalid native interval
or a complete alignment failure can still have no timestamp. No synthetic times
are invented. The rejection rules below describe intermediate validation, before
this final review fallback. Recognition text remains unchanged. Production captions now use this same
Tara configuration by default, with Shruti available via Quick mode.

Two chunks run concurrently, with two CPU threads per worker and a shared native
model pool. Results are restored to source order. A single-chunk recording uses
one worker with four threads. Every job releases the model on exit; cancellation
terminates its process tree. No model is kept loaded between edits.

Word alignment now reuses the full-audio Silero speech intervals already computed
for chunk planning. It constrains native DTW boundaries to speech regions, with
60 ms edge padding, ignoring gaps shorter than 350 ms. Small boundary leakage
(up to 200 ms) may be excluded when only one substantial speech region overlaps
a word. Speech evidence is measured on the unpadded detection intervals; padding
is only boundary tolerance and cannot create additional speech evidence.
Short onsets with only tiny overlaps may use the native end anchor when
the earlier overlap belongs to a timed previous word. If multiple substantial
regions overlap, or no speech overlaps, the word
remains in the transcript with unavailable times. No evenly spaced or guessed
word times are generated. Recognition audio, transcript text and native DTW paths
are unchanged. The exported `wordAlignment` retains speech intervals, original
boundaries and every adjustment under `timingConstraint: silero-speech-bounds-v1`.
This is a conservative acoustic constraint, not a new word recognizer; inaccurate
VAD can still affect boundaries. Playback verification remains necessary.

If timings remain unavailable, one bounded forced-alignment retry is made for
that chunk. Its alignment-only audio concatenates the detected speech regions
with edge context. The exact original tokens are aligned again, without calling
ASR generation. A sample-accurate piecewise map restores times to the original
clock; starts at joins map forward and ends map backward, preserving pauses.
Only previously unavailable times can be recovered. Candidates overlapping good
neighbours, crossing ambiguous speech gaps, or longer than two seconds remain
unavailable for review. Recognition confidences and accepted times are preserved.
For short words split by VAD, the original DTW interval may be retained when
the original and compacted paths agree within 80 ms at both ends, the interval
is at most 1.5 seconds, both edges touch detected speech (100 ms tolerance), and
no internal VAD gap exceeds 900 ms. Neighbour overlap checks still apply. This
is an alignment-consensus heuristic, not proof of exact acoustic timing. Its
candidate indices are exported as `shortWordConsensusIndices`; successful
recoveries also appear in `recoveredWordIndices`. It never admits long pauses
such as the earlier 14-second interval.
The retry's paths, probabilities, sample map, recovered indices, and any errors
are exported under `wordAlignment.refinement` (`speech-compacted-dtw-v1`).

Only affected chunks incur an extra encoder/alignment pass; there is no extra
transcription. Errors retain the first-pass result. Audio Lab shows timed-word
coverage and explicit warnings for unresolved words. Existing exports are
immutable; run a new comparison to test the correction. Automated tests use
mocked recognition and synthetic audio, not real recordings or benchmarks.

Exports record `chunkWorkers`, `requestedChunkWorkers`, `threadsPerWorker` and
`chunkScheduling`. Alignment time is summed across tasks, not an additive
wall-clock stage. Use `processingSec` for latency.

## Historical experiments

The following sections describe previous configurations, not current choices.

## Compare chunking strategies

Audio Lab now has two selectable cards: **Tara – INT8 Standard** and
**Tara – INT8 Speech-aware**. Original FP32 has been removed from the runnable
catalog; its type/name remain readable in historical results. The original
checkpoint stays in the local cache as a source for verifying/rebuilding INT8.
No extra weights or runtime are installed for Speech-aware.

Select both cards and click **Run** to compare them sequentially on the same
prepared audio. Both use word alignment when compared together. Standard remains
the existing recognition/chunking behavior; Speech-aware scans the complete
recording for pauses, chooses variable-length chunks, and uses 600 ms of overlap
only around forced cuts without a reliable pause. Every input stays at most
30 seconds. All original audio and silence are retained.

Only complete timed suffix/prefix matches of at least two distinct words are
deduplicated. Ambiguous matches retain both hypotheses with a review warning.
Raw chunk outputs, plans and decisions remain in JSON. Word timing estimates
still need manual review. No recording is automatically processed or benchmarked.

Install/verify and removal live on the Standard card because the installation is
shared by both profiles. On a fresh setup, **Install / convert** first caches the
original source and isolated Tara runtime. If prompted for the native runtime,
run `scripts/setup-tara-int8.ps1`, then retry conversion.

## Optional word timing

In Audio Lab, select **Tara – INT8 Standard**, enable **Tara INT8 word timing
(experimental)** in Recognition settings, then click **Run**. It is off by
default, so existing performance comparisons remain transcript-only unless
requested. Original Tara and production Auto Captions are unchanged.

Inspect **Word timestamps** to seek returned word boundaries during playback.
The alignment uses the preserved Tara cross-attention heads and native DTW path,
with the same Hindi/mixedcode/transcribe prefix. Generation and alignment reuse
one encoder output per chunk. The decoder appends the no-timestamps token during
alignment itself; it is not supplied twice. Original recognized text is retained.

An existing Tara INT8 result in the current Audio Lab session offers **Align saved
words**. This creates a separate result from the saved token IDs without calling
recognition again. Audio SHA256, full chunk coverage, token IDs, checkpoint
revision and decoded chunk text are checked before alignment. Original results
are retained. Exported JSON files are not imported by this action.

Word boundaries are experimental audio-derived estimates, not verified timing.
Hindi byte pieces/vowel marks and English contractions are grouped into words
without rewriting text. Chunk offsets stay on the original prepared audio clock.
Missing, non-monotonic, out-of-range or zero-length boundaries are not interpolated.
Words spanning at least 350 ms of a sustained near-zero PCM interval (at least
400 ms below RMS 0.0001) keep their text but receive unavailable times. This is a
conservative rejection guard, not a full speech detector; quieter speech/music
and difficult pauses still require manual review. A rejected timing is never
replaced with evenly spaced or neighboring-word estimates.

Alignment errors retain recognized text with unavailable word times and an
explicit warning. No new model download or weight conversion is required. Original
chunk token IDs, DTW paths and token probabilities are included in JSON exports.
Probabilities describe token recognition, not calibrated timing confidence.

New recognition runs report alignment time as part of inference time. Saved-result
alignment keeps original recognition metrics and reports its separate job time,
load time and peak RAM. No real recording or ASR benchmark is automatically run.
This adds no subtitle segments or caption/timeline import; TXT/JSON exports remain
available, and SRT/VTT remain disabled for Tara.

## INT8 comparison

Audio Lab also offers **Tara – CTranslate2 INT8**. Select this and **Tara – Original
(CPU FP32)** together, optionally adding Shruti as the third model, then click
**Run**. The original checkpoint and production caption defaults are unchanged.

On this machine the native runtime and conversion are already installed. Click
**Refresh models** if the card still shows an old installation status.

For a fresh Windows development install, use Install / convert on the Standard card to cache the source and runtime first, then run:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/setup-tara-int8.ps1
```

Then use **Install / convert** on the INT8 card. This verifies the original local
assets and creates `models/tara-int8` once; **Verify conversion** reuses a valid
hash-checked conversion. No recording is transcribed during setup.

INT8 uses CTranslate2 4.8.4, `int8_float32`, 4 intra-op threads, 1 worker, greedy
decoding, batch size 1, and exactly the same prepared audio, 30-second pause-aware
input boundaries, tokenizer/preprocessing files and five-token Hinglish prefix.
The complete original chunk text/token IDs remain in JSON. Optional word
alignment is described above; subtitle segment boundaries are not synthesized. The converted model is about
1.56 GB on disk; working RAM, speed and accuracy need manual measurement.

Tara requires two small native compatibility changes relative to upstream CT2
commit `5de572ef60b67a0276c5989ee73d0072808ff4c3`: recognize its additional
`<|mixedcode|>` ID 51866 as part of the decoder prefix, and allow the full
448-position budget instead of the standard Whisper wrapper's half-length cap.
The original token IDs are retained. A pure native parser probe verifies the
actual compiled prefix handling without running inference. Timestamp token
suppression matches the original no-timestamps configuration.

The native builder is `scripts/build_tara_int8.py`. It uses Visual Studio C++
Build Tools, CMake, Ninja and Intel MKL, with CPU dispatch and no CUDA, and writes
source/binary provenance to `experimental-runtimes/tara/tara-int8-native.json`.
This Tara family runtime is separate from Shunya and the main speech environment.
Torch's existing Intel OpenMP DLL is the single provider; duplicate CT2/MKL
preload copies are retained with `.stock` suffixes. No duplicate-runtime override
is used. Original Tara's pinned Python packages and weights stay intact.

The native builder explicitly sets and verifies `/O2 /DNDEBUG` on the generated
C/C++ compiler commands. Earlier local builds had an empty Release flags cache
despite the Release label. New exports identify the corrected build through
`runtimeVersions.taraNativeOptimization`. This rebuild reuses the same converted
weights and decoding profile; its speed and recognition output need comparison
against the earlier export. Setup performs no automatic recording inference.

Conversion uses a smaller FP16 intermediate before INT8 quantization to limit
peak conversion memory. This is a lossy experimental derivative, not an exact
copy of full-precision inference. Original tokenizer and native alignment heads
are preserved and validated; alignment is not used to fabricate timings.
Deleting one Tara model retains the shared family runtime while the other
remains installed. Conversion requires the original source; an installed INT8
model can run independently of the original weight file.

Tara is an optional Audio Lab model. Shruti remains the default and the only
production Auto Caption recognizer. This integration does not edit a project,
create captions, or register an alternative production model.

## Manual test

1. Open Audio Lab (`Ctrl+Shift+L` in the desktop development app).
2. On **Tara – Original (CPU FP32)**, click **Download**. This installs its isolated
   CPU runtime and the original checkpoint. Interrupted model downloads resume.
   **Verify / repair** verifies cached downloads and installs a missing runtime.
3. Import your audio/video, then select the existing Shruti and Tara cards.
   Select up to three models; **Run** processes them sequentially.
4. Review the separate original outputs, listen using the existing audio player,
   and paste your verified reference to inspect normalized WER. WER includes
   spelling/script differences and is not a semantic accuracy score.
5. Copy or export each transcript as TXT/JSON, or export the latest comparison
   batch as benchmark JSON/CSV. These include runtime versions, load/inference
   time, RAM, original text and per-input-chunk outputs.

Tara reports **no word timestamps**. This initial accuracy profile uses the
official no-timestamps decoding prefix. It does not manufacture subtitle times
from input chunk positions and does not offer SRT/VTT export.

## Model and decoding

- Original: <https://huggingface.co/Trelis/tara>
- Revision: `4dd4782d65ed8c9690b52478e4419d577fff40be`
- Licence: Apache-2.0; original model README is retained with the download.
- Original BF16 safetensors: 3,087,229,512 bytes. Total pinned download about 3.09 GB.
- SHA256: `48722cacd4a64028d785484b4d336ded216c401b52dc1f45a1686050835eac9b`.
- Weights are loaded into CPU FP32, without conversion, quantization, fine-tuning,
  keyword corrections or transcript rewriting.
- Architecture: Whisper, 1280 hidden width, 32 encoder/decoder layers, 128 mel
  bins, 51,904 vocabulary entries. Original tokenizer/preprocessing/configuration
  files are downloaded and verified as a pinned set.
- Prefix: `[50258, 50276, 51866, 50360, 50364]`, corresponding to
  start-of-transcript, Hindi, **mixedcode**, transcribe, no timestamps.
- Matches the official reference evaluator's explicit `decoder_input_ids`
  approach: <https://github.com/TrelisResearch/tara/blob/main/evaluation.py>.
- Greedy decoding, batch size 1, 4 intra-op / 1 inter-op threads, SDPA.
- All prepared samples are processed, with contiguous pause-aware input chunks
  of at most 30 seconds and no overlap/VAD removal. No previous-chunk text is
  injected. Chunk ranges are input coverage only, not recognized speech timing.
- The decoder budget is 448 positions including the 5-token prefix. A token-limit
  warning appears if generation may have been truncated. Processing every input
  chunk does not guarantee every spoken word was recognized.
- This experimental profile fixes Hindi–English mixed-code mode. General language,
  device, VAD and keyword controls do not override it.

## Isolation and verification

App-local Speech Lab storage contains `models/tara` and
`experimental-runtimes/tara`. Installation pins CPU PyTorch 2.10.0+cpu,
Transformers 4.46.3 (the checkpoint's recorded version), tokenizers 0.20.3,
huggingface-hub 0.36.0, safetensors 0.7.0, NumPy 2.3.5 and psutil 7.2.2.
The existing Shruti/Shunya/Whistle environments are unchanged.

Installation checks dependencies, imports, architecture, tokenizer IDs and the
original weight header without running inference. Inference uses local-only
loading with Hugging Face offline flags in an owned child process. Existing
Audio Lab cancellation terminates that process tree. **Remove** deletes Tara's
dedicated model/runtime directories only.

CPU FP32 requires considerably more working RAM than the BF16 file size. Its
speed and recognition quality must be measured manually; no automatic benchmark,
real recording transcription or promotion is performed during installation.
