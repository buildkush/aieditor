# Native caption engine migration

Production caption jobs run in-process in Rust. Tauri and the standalone
`native/speech` CLI call the same library and use
`%LOCALAPPDATA%\com.aiditor.app\speech-lab`. They never mutate an editor project.
Reviewed captions are imported through `ApplyCaptionTrackCommand`, an alias of
the existing validated, undoable `ImportAutoCaptionsCommand`.

Python/CTranslate2 dependencies and model environments are no longer part of
`setup.cmd` or packaged app resources. The Python backends, experiments and installers have been removed. Only native Tara and Shruti are supported.

## Models

- Tara: pinned original safetensors are verified and converted by Rust to GGML
  Q8_0, or Q5_0 with `aiditor models install tara-q5_0`. The 51904-entry vocabulary,
  token 51866 (`<|mixedcode|>`), 128 mel bins and model alignment heads are
  preserved. Conversion uses the pinned OpenAI Whisper mel-filter asset; its
  SHA256 is `7450ae70723a5ef9d341e3cee628c7cb0177f36ce42c44b7ed2bf3325f0f6d4c`.
- The vendored `whisper-rs-sys` 0.15.0 is from upstream revision
  `7558e1b72f54f2f22a53589afb77e65681834c36`. Tara's vocabulary padding must not
  change Whisper's language-token offsets. The decoder inserts mixedcode between
  language and task tokens. Passing it as an ordinary initial prompt is incorrect.
- Shruti is **not a Whisper model**. Its pinned `.cact` weights run through the
  verified Needle 3.3.3 native DLL using its C ABI, without importing wheel code
  or running Python. Its weights remain about 29 MB. It is not a general forced
  aligner for arbitrary Tara text.
- Quantization is lossy. Neither Q8_0 nor Q5_0 is a bit-exact reference.
- Original checkpoints are reused if verified. Converted GGML files have their
  own SHA256/size manifests. Downloaded source weights are read only during conversion. Obsolete checkpoints may be removed after validating the GGML files. Initial conversion needs additional temporary disk
  space; a published, verified preconverted Tara download is not configured yet.

Native model IDs are `tara`, `tara-q5_0`, and `shruti`. Tara uses standard Whisper windows without VAD scheduling.

## Audio and timing

FFmpeg decodes read-only source media to cached 16 kHz mono float PCM. The native
project mixer preserves timeline offsets, gaps, overlaps, trims, reverse,
pitch-preserving forward speed and gain automation. Native jobs are bounded to
two hours of audio to limit memory allocation. Their current mix is in memory.

Tara uses its alignment heads with whisper.cpp token timing. Word assembly
decodes the combined byte stream before splitting words. Valid UTF-8 sequences
spanning tokens remain intact. Malformed model bytes become visible replacement
characters with review warnings, instead of aborting the transcript.
Unavailable/invalid timings fail
instead of being evenly spaced. Word times remain estimates requiring review.
Flash Attention disables DTW in the pinned upstream API, so this implementation
prioritizes DTW and leaves Flash Attention off. The Tara prefix is preserved in
the alignment pass, and word intervals use the native 20 ms DTW path. Partial
word events are provisional and never edit ProjectState. Final words pass
validation before use. Owned C callback bridges avoid a broken abort callback
cast in whisper-rs 0.16.0 and release callback storage after each job.

The development builds optimize hashing and inference glue. A model is fully
hashed on first use; later jobs in the same process reuse verification only when
its expected hash, size, modification time and creation time are unchanged.
Total processing time includes verification, preparation, loading and inference;
verification is also reported separately. CPU inference with Tara remains slow
and must be compared against the prior engine on the same recording.
Native CPU inference now caps automatic parallelism at physical cores on Windows
(and eight threads maximum). See [the CPU investigation](caption-cpu-performance.md)
for the measured eight-thread decoder regression and the new stage counters.
Tara also uses its remaining trained text context rather than stock Whisper's
half-context token cap, with rolling text history disabled to match the previous
Tara pipeline. Token-limit hits and fallback retries are recorded explicitly.

Shruti runs bounded 20-second native calls with original source offsets for
cooperative cancellation. Boundary words are flagged for review. This differs
from the previous Silero-based chunking; pause/hallucination behavior and quality
must be evaluated on controlled fixtures before declaring parity.

## CLI and agents

After setup, the CLI is `native\speech\target\release\aiditor.exe`. Use that full
path or put its directory on PATH:

```powershell
aiditor models status tara
aiditor models verify tara
aiditor transcribe C:\media\clip.mp4 --model tara --language hi --output-format json
aiditor transcribe C:\media\clip.mp4 --model shruti --output-format json
aiditor hardware
```

JSON goes to stdout; progress and native diagnostics go to stderr. Times are in
seconds. File transcription is read-only analysis, not an alternate editing
timeline. Agents must use editor commands to apply results to an active project.

`aiditor mcp` runs a newline-delimited JSON-RPC MCP server on stdio. Configure
the client with an absolute executable path and `args: ["mcp"]`. Tools are
`transcribe_start`, `transcribe_status`, `transcribe_cancel`, and
`transcribe_release`. Start returns a job ID immediately; poll status for the
result and release completed jobs. There is one active job per server, with up
to 32 retained job records. This avoids tying a tool timeout to inference speed.

For the same JSON-RPC tools over local HTTP:

```powershell
$env:AIDITOR_HTTP_TOKEN = 'replace-with-a-random-token-of-at-least-24-characters'
aiditor serve --port 49823
```

POST JSON-RPC to `http://127.0.0.1:49823/` with
`Authorization: Bearer <token>`. The server binds only loopback, rejects browser
Origin headers, and bounds request size. It does not enable LAN GPU workers.

## Acceleration and release work remaining

The base binary links CPU whisper.cpp and can load optional GPU cdylibs through
a versioned C ABI. Every pack member is verified before loading. Missing DLLs,
pack/checksum errors and reported GPU initialization failures try the next
backend and then CPU. The base binary does not link CUDA startup dependencies.

`aiditor runtime auto` detects NVIDIA through `nvidia-smi` or WMI, checks the Vulkan
loader, and selects from the pinned pack catalog. **The catalog is currently
empty**: no tested Tara-patched CUDA/Vulkan release pack has been published.
It reports CPU fallback explicitly. Installing only cuBLAS is insufficient;
a matching compiled inference plugin is also required.

For release builders, `scripts/build-native-acceleration.ps1 -Backend Cuda
-ReleaseBaseUrl https://your-release-location` builds and hashes a pack. Building
needs the CUDA 12 toolkit; Vulkan builds need the Vulkan SDK. End users need
the verified pack and a compatible display driver, not those SDKs. A tested
manifest can then be pinned in `native/speech/runtime-packs.json`, or explicitly
installed with `aiditor runtime install manifest.json`.

No 25 MB base, 120 MB compressed pack, or sub-10-second RTX 3050 result has been
validated. GPU initialization, VRAM limits, quality/word sync and speed still
require tests on the actual GPU device. Compiled backend availability is not
proof that a workload used that GPU. CPU/GPU numerical outputs need comparison.

On the GPU PC, after installing a matching pack and selecting a 90-second test
clip, run:

```powershell
.\scripts\benchmark-native-captions.ps1 -InputPath C:\media\test-90s.mp4 -RequireCuda
```

This measures full CLI wall time, saves the transcript/diagnostics in app cache,
checks source immutability, and fails on CPU fallback or a missed time target.
Confirm actual utilization with GPU telemetry. The measured CPU CLI executable
is about 6 MB; FFmpeg, VC++ runtime, weights and desktop packaging are separate.

## Validation

```powershell
cargo test --manifest-path native/speech/Cargo.toml --lib
cargo build --manifest-path src-tauri/Cargo.toml
npm.cmd test
npm.cmd run build
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-setup.ps1
```

Native unit tests use small in-memory fixtures; they do not transcribe personal
recordings. `models verify tara` checks loading/architecture without recognition.
Opt-in recognition tests require `AIDITOR_CAPTION_TEST_PCM` pointing to an
explicitly selected 16 kHz mono f32le synthetic fixture containing "hello":

```powershell
cargo test --manifest-path native/speech/Cargo.toml --test native_fixture -- --ignored --nocapture
```

Q8_0 and Q5_0 conversion and loading have been checked locally. Tara Q8_0, Q5_0
and Shruti returned the expected English synthetic speech and valid word
intervals on CPU. This small smoke test does not establish multilingual quality,
long-clip boundary quality, silence handling, GPU parity or GPU latency.
# Native CT2 CPU follow-up

The optional Python-free CTranslate2 CPU backend and portable runtime foundation
are documented in [native runtime deployment](native-runtime.md). Tara Automatic
can select an installed CT2/MKL pack and CT2-format artifact; GGML remains available
for fallback and explicit comparisons. GPU runtime packs are not yet published.

