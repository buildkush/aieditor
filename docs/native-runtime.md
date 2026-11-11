# Native speech runtime and deployment

For hardware validation, see [CPU then GPU testing on a second machine](test-second-machine.md).

The caption service is shared by Studio, the CLI, and loopback HTTP/MCP jobs.
Analysis returns source-clock words. Only the existing typed caption command
applies them to an active ProjectState. No renderer, engine, or agent maintains
a separate editing timeline, and source recordings remain immutable.

## Implemented foundation

- Native CTranslate2 4.8.4 CPU bridge with optional dynamically loaded runtime.
  The base executable does not link MKL, CT2, or CUDA at startup.
- Native Rust log-mel extraction, byte-BPE output decoding, pause-aware chunk
  planning, bounded workers, attention/DTW word timing, acoustic pause constraints,
  and cancellation. Ambiguous intervals retain their native values and review
  warnings; the former compacted-audio forced-alignment retry is not yet ported.
- Tara conversion without Python: pinned source checkpoint, float16 intermediate,
  CT2 INT8/FP32, fused QKV/KV layers, tied output projection, 128 mel bins, and
  custom mixed-code token 51866. Runtime probes verify the compiled five-token
  prompt and full generation budget before a model can run.
- CPU scheduling accounts for available physical cores, ready chunks, available
  memory, shared weights, and estimated private worker memory. Four cores and
  enough memory select 2 workers x 2 threads for multiple chunks; one chunk uses
  one worker. This is an initial heuristic, not a completed calibration system.
- A cache-scoped OS file lease serializes speech jobs across Studio, CLI, and
  agent processes. Waiting remains cancellable; OS process exit releases a lease.
- Portable CPU topology/instruction detection and application-data directories.
  CUDA uses the installed driver API; Vulkan enumerates compute-capable physical
  devices; macOS probes Metal. Hardware presence is not proof of model offload.
- Runtime manifests check OS/architecture, ABI, file lengths, and SHA256 before
  loading. Missing/unusable GPU packs return to CPU. GPU results must identify
  GPU-resident model buffers, including integrated GPUs.
- Pinned Shruti library selection for Windows x64/ARM64, Linux x64/ARM64, and
  macOS Intel/Apple Silicon. Only Windows x64 has been exercised locally.
- Cross-platform Rust CI and a Linux CT2 compiled-contract job are defined;
  their remote results are not yet available.

## Engine selection

`auto` tries installed compatible GPU packs (CUDA, Metal, Vulkan as appropriate),
then an installed CT2 CPU pack with its CT2 Tara artifact, then the existing GGML
CPU path. Explicit `--engine ctranslate2` fails clearly if its dependencies fail;
it does not substitute a different engine. `--engine whisper-cpp` retains the
GGML path for comparisons. `tara-q5_0` always refers to the GGML Q5 artifact.
Shruti continues to use Needle.

If CT2 fails in automatic mode, GGML CPU fallback is possible only when the GGML
artifact is already installed. Inference never downloads another multi-GB model
silently. Each engine supports CPU execution with its own model format; CT2 and
GGML formats are not interchangeable.

The old eight-thread GGML regression remains guarded by its conservative physical
core policy. CT2 scheduling can scale beyond eight total threads. AVX-512 is not
enabled globally: CT2 builds retain runtime CPU dispatch. The current GGML x86
build still targets AVX2-class CPUs; an older-CPU baseline release is remaining
work, not a claim that every existing binary runs on every processor.

## Local developer validation

Build on a release-builder machine, not an end user's machine:

```powershell
# Run from a C++ developer shell with CMake/Ninja available.
.\scripts\build-native-ct2.ps1 -Backend mkl -DownloadBuildDependencies
```

The optional Windows bootstrap extracts pinned native Intel build archives as ZIP
files. It invokes neither Python nor pip. It does not install a Python environment.
The script runs a compiled model-free prompt/context probe and produces a pack
under `tmp/ct2-build-mkl/payload`. Build inputs and output are ignored by Git.

```powershell
$cli = '.\native\speech\target\release\aiditor.exe'
& $cli runtime import '.\tmp\ct2-build-mkl\payload'
& $cli models convert tara --engine ctranslate2 --source 'PATH-TO-PINNED-TARA-SOURCE'
& $cli transcribe sample.wav --model tara --device cpu --engine ctranslate2
& $cli transcribe sample.wav --model tara --device cpu --engine whisper-cpp
```

`models convert` is a developer/release-builder operation. It verifies the original
checkpoint and required metadata before writing the separate CT2 artifact. The
original input is never modified. A small pinned Silero preprocessing dependency
(885,098 bytes) is cached once for pause-aware boundaries; it removes no recognition
audio. This converted Silero version can produce slightly different boundaries
from the former ONNX detector. Neither transcript nor timing parity is assumed.

Models and installed packs persist between jobs. Per-job model contexts are freed
after workers finish; weights are not deleted or reinstalled after each clip.

## Standalone release work still required

The existing `setup.cmd` is a source-development setup and still needs build tools.
It is not the planned standalone end-user installer.

Before shipping the production installer:

1. Publish qualified per-platform packs and preconverted model artifacts with
   pinned checksums. `runtime-packs.json` is intentionally empty until then.
2. Install only the chosen engine's model and compatible runtime. Reuse validated
   system drivers/runtime dependencies; distribute missing redistributable DLLs
   privately. End users must not need compiler SDKs or Python.
3. Validate native CT2 on representative Intel/AMD CPUs and CUDA/Vulkan/Metal on
   actual GPUs. Current GPU pack builders are preparation, not validated releases;
   Linux CUDA dependency packaging remains explicit unfinished work.
4. Supply a portable x86 baseline plus optimized dispatched kernels, finish hybrid
   core/affinity policy, and add bounded calibration keyed by model, driver,
   backend, and CPU/GPU identity. Coordinate editor/render/other AI job pressure.
5. Trim and measure runtime dependency closures and verify clean-machine offline
   operation. The current broad Windows MKL test pack is about 390 MB unpacked;
   it is optional, not part of a claimed 25 MB universal base bundle.

No GPU latency or universal peak-performance claim is established by the CPU test.
