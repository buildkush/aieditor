# Tara CPU performance investigation

## Measured Q5 memory tradeoff

A sequential Windows CPU comparison on the same 83.68475-second PCM measured
the native CLI processes with OS peak working-set counters sampled every 200 ms:

| Pipeline | Total | Peak resident working set | Maximum sampled private bytes | Words |
| --- | ---: | ---: | ---: | ---: |
| Native CT2 INT8/MKL | 134.07 s | 3010.0 MiB | 7186.8 MiB | 277 |
| whisper.cpp Q5_0 | 230.81 s | 2294.7 MiB | 2868.4 MiB | 272 |

Q5 saved about **715 MiB / 24% resident peak** and about **4.2 GiB / 60% private
commit**, while taking about 72% longer in this run. Private bytes include paged
committed memory and must not be described as simultaneously resident RAM. This
is a real low-memory use case, so Q5 remains optional rather than being removed
solely because it is slower. It is not selected or installed by default.

CT2 selected one worker x four threads because available memory was limited at
the start of this test. This is not a controlled comparison of equal kernels,
worker counts, or recognition quality. It measures this app's CPU configurations
on one machine. It does not measure GPU VRAM, whole-editor memory, FFmpeg child
memory, every workload, or every device. The hashes matched; matching word counts
or timing intervals alone do not establish accuracy. The JSON evidence is retained
locally in `tmp/caption-memory-comparison.json`, outside Git.

## Native CTranslate2 follow-up

The final automatic-selection run, including the shared process lease and acoustic
pause constraints, completed in **115.21 seconds total / 109.13 seconds inference**.
It selected native CT2/MKL with two workers x two threads, returned 277 words,
and had zero token-limit hits, no malformed UTF-8, and no word interval longer
than two seconds. Five ambiguous acoustic boundaries still require review. The
export records the platform, CPU topology/instructions, memory budget and backend.
The following earlier valid run demonstrates normal timing variation:

The Python-free native CT2 bridge completed the exact same 83.68475-second PCM
in **122.47 seconds total / 116.94 seconds inference**, with four pause-aware
chunks and two workers x two threads. Model loading took 2.15 seconds; model and
runtime verification took 2.38 seconds. It returned 277 words, with zero token-limit
hits and no replacement characters. Source PCM SHA256 remained identical.

This compares with the saved old CT2 total of 158.36 seconds and the user's latest
corrected GGML Q8 total of 194.28 seconds. These are recorded runs on this CPU,
not simultaneous controlled measurements or cross-device performance guarantees.
Three chunks produced identical token IDs and text to the old CT2 export; the
third chunk differed. Native Silero boundaries also differ slightly from the former
ONNX detector. Word counts do not establish WER or equivalent timestamp quality.
The former compacted-audio alignment retry is not yet ported; this is not an
exactly identical timing pipeline. Acoustic constraints trim unambiguous pauses;
remaining ambiguous native intervals are explicitly marked for review.

An earlier 120.14-second native CT2 trial was rejected: a patch-application defect
left a 224-token limit and only 255 words. The corrected bridge now verifies its
compiled five-token prefix parser and 444-position generation budget (448 total,
four prompt-prefill steps) before loading a model. This protects against reporting
truncated recognition as a performance improvement. A model-free compiled probe
is part of the pack build.

See [native runtime deployment](native-runtime.md) for the implemented foundation,
local builder commands, measured packaging limits, and remaining release work.

The 83.68475-second recording's saved exports showed:

| Pipeline | Total | Inference |
| --- | ---: | ---: |
| CTranslate2 Tara INT8, two workers × two threads | 158.36 s | 151.09 s |
| Native Tara Q8, previous automatic thread setting | 475.77 s | 472.62 s |
| Native Tara Q5, previous automatic thread setting | 504.62 s | 502.34 s |

Model verification and loading explain only a few seconds of the native totals.

## Controlled stage measurements

An immutable 12-second excerpt was prepared from the native benchmark's cached
PCM. The full cached audio SHA256 was
`f3b14bb181ef8b3ddc3500d5da9fe9d564decff877cf48415424e2763ff1dce0`.
The test machine was an Intel i7-1165G7, four physical cores/eight logical CPUs.
Both clean runs used Q8, identical PCM, greedy best-of-one, temperature fallback
enabled, DTW alignment enabled and Flash Attention disabled.

| Threads | Encoder | Recognition decoder | Alignment (decoder + processing) | Inference total |
| --- | ---: | ---: | ---: | ---: |
| 4 | 45.02 s | 11.27 s | 4.99 s | 61.52 s |
| 8, clean repeat | 35.79 s | 370.34 s | 6.83 s | 413.28 s |

Both produced identical text, made 140 single-token decoder calls and had zero
decoding retries. An initial eight-thread run overlapped with compilation and
was excluded from this clean comparison. Its decoder was also slow.

The result establishes pathological decoder scaling with eight threads on this
configuration. It does not establish a universal speed ratio, full-recording
parity, or the exact low-level scheduler/cache mechanism. Alignment and retries
were not the primary bottleneck in this sample.

## Full-recording context-budget defect

A four-thread run on the exact original 83.68475-second PCM (matching the saved
native export's SHA256) still took 490.89 seconds in inference. Its counters
showed three encoder calls, **18 decoding attempts and 15 retries**, with 3,942
single-token decoder calls. Generation consumed 322.40 seconds, encoding 136.10
seconds and alignment 24.53 seconds. It still returned only 211 words.

The custom Tara port had inherited stock whisper.cpp's `n_text_ctx/2 - 4`
generation budget: **220 tokens**, which reserves context for rolling history.
The previous Tara pipeline allowed the full trained context and did not condition
on previous chunks. Dense Hindi byte-BPE output hit the native limit, failed the
decode, retried at each fallback temperature, and could end on a partial Unicode
sequence. Word timing was then computed on the shortened output.

The correction uses remaining context for Tara without history (442 generated
positions for its five-token prefix and 448-position context, reserving one
position). Both `no_context` and a zero rolling prompt budget are set: upstream
`no_context` alone clears history from an earlier full call, not all history
between audio windows. Other Whisper models retain their existing budget.
Token-limit hits are now exported explicitly and produce a coverage warning.
These corrections address the cause of truncation instead of merely recovering
malformed UTF-8 output after the fact.

## Verified full-recording result

After both corrections, the exact original PCM completed in **212.53 seconds**
(207.98 seconds inference), compared with the saved native Q8 export's 475.77
seconds. It made three decoding attempts with zero retries and zero token-limit
hits. It returned 271 words with no replacement characters, versus 211 words in
the broken native run and 277 in the saved CTranslate2 export. No manual reference
was supplied, so these word counts do not establish WER or accuracy equivalence.

The corrected profile measured 116.31 seconds encoding, 63.73 seconds generation
decoding, and 26.76 seconds alignment. Encoding is now the largest remaining
stage. This remains slower than the saved CTranslate2 baseline of 158.36 seconds;
native CPU performance parity has not been established. The newly corrected Q5
configuration has not yet been measured on the full recording.

## Implemented correction

Native Tara now budgets inference threads from Windows physical-core topology,
bounded by available parallelism and eight workers. This machine selects four.
Other platforms currently use a conservative four-thread fallback. Models and
caption word timing behavior are unchanged.

Benchmark metadata now includes `nativeProfile`: encoder, recognition decoder,
alignment replay/postprocessing and sampling times; thread count; decoder calls;
and retry/failure counts. Alignment replay time is excluded from the recognition
decoder counter to avoid double counting. The profile is obtained from the
owned live native state after inference returns.

For read-only experiments, the CLI supports:

```powershell
aiditor transcribe sample.wav --model tara --device cpu --diagnostic-threads 4 --diagnostic-alignment true --diagnostic-fallback true
```

Recognition-only experiments can explicitly set diagnostic alignment to false;
they return no word timings. Project-caption commands reject diagnostic settings.
These flags are intended for controlled comparisons, not quality claims.

## Practices worth adopting

- [CTranslate2's CPU guidance](https://opennmt.net/CTranslate2/performance.html)
  recommends INT8, tuning inter/intra-operation parallelism and staying within
  physical-core budgets.
- [Buzz](https://chidiwilliams.github.io/buzz/docs/preferences) supports multiple
  transcription engines rather than assuming one engine suits every machine.
- [Intel's Audacity plugin](https://github.com/intel/openvino-plugins-ai-audacity)
  uses whisper.cpp with an OpenVINO encoder backend. Encoder optimization remains
  a candidate after correcting our decoder thread budget.
- [faster-whisper's comparison guidance](https://github.com/SYSTRAN/faster-whisper#comparing-performance-against-other-implementations)
  calls for matching decoding options, CPU threads and recognition quality.

Full-recording regression tests and quality comparisons remain necessary. Tara
is a custom large-v3-derived checkpoint; small/base model benchmarks and standard
Whisper defaults cannot be assumed to transfer unchanged.
