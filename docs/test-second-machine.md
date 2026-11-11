# Test an Intel i5 machine: CPU first, then GPU

Use the same audio, model checkpoint, language hint and word-timestamp requirement
on both machines. An i5 label alone does not determine performance; the report
records the exact processor, cores, instructions, RAM, GPU and driver information.
Connect laptops to power and close other heavy workloads for the timing runs.

## Transfer the existing native CPU assets

The simplest migration is the [verified update/transfer workflow](update-existing-installation.md):
copy `transfer/aiditor-native-speech` from the working machine, pull the latest
source, then run `setup.cmd -SpeechBundle "D:\aiditor-native-speech"`.

Cloning/pulling Git transfers source, not the model/runtime cache. The current
`setup.cmd` does not download the unpublished native CT2 pack and CT2 Tara artifact.
Do not count a GGML fallback as a CT2 comparison.

For this Windows x64 development test, copy the following from the working machine
into the same relative paths under the other user's
`%LOCALAPPDATA%\com.aiditor.app\speech-lab\` (the username itself may differ):

```text
models/tara-ct2-int8/        Native CT2 Tara weights + config + installed marker
models/preprocessing/       Small native speech-boundary asset
runtime/ct2-cpu/             Verified CT2/MKL runtime + manifest + licenses
```

Close speech jobs while copying into the destination cache. Keep filenames and
markers intact; the CLI verifies checksums before loading. There is no need to
transfer `.speech-lab-venv`, original safetensors, build tools, downloaded build
archives, `node_modules`, or Rust `target` trees.

Either build the current native CLI on the second development machine, or copy
the compatible Windows x64 `native/speech/target/release/aiditor.exe` from the
working machine into the same location in its checkout. A copied CLI avoids a
local compilation step. The normal Windows C++ redistributable and FFmpeg must
be available; FFmpeg can already be installed or be supplied next to the CLI.
Use `-CliPath` if the CLI is stored elsewhere. Do not push binaries/models to Git.

## CPU benchmark

From PowerShell in the updated repository on the i5 machine:

```powershell
.\native\speech\target\release\aiditor.exe hardware
.\scripts\benchmark-native-captions.ps1 -InputPath 'C:\clips\same-test.wav' -Model tara -Device cpu -Engine ctranslate2 -Runs 3
```

This explicitly disables GPU selection, even if an NVIDIA GPU is present. It must
report `ctranslate2`, `int8_float32`, and `cpu`. Worker count is selected for that
machine's available physical cores, number of chunks and memory; do not force the
previous laptop's 2 x 2 configuration onto a different i5.

There is no default latency pass/fail target. `-MaxSeconds` is an optional explicit
target, not a ten-second requirement imposed on CPU tests. Each iteration launches
a fresh process/model; repeat timings can still benefit from OS file caches.

The script saves a machine/hardware summary, each complete transcript, and native
diagnostics under the app cache's `benchmarks` directory. It prints `reportPath`.
Compare `audioSha256`, total/inference time, worker layout, word count, omissions,
spelling and pause-boundary timings. A matching word count does not prove accuracy.

## NVIDIA GPU benchmark

First obtain the actual NVIDIA model, memory and driver from `aiditor hardware`
(or `nvidia-smi`). A GPU driver by itself does not add CUDA inference to the base
binary. A compatible Tara-patched CUDA plugin and its redistributable runtime
libraries are required. **No downloadable GPU pack is currently published.**

The development builder is `scripts/build-native-acceleration.ps1`. It needs the
CUDA SDK on a release-builder machine; users receiving its compiled pack do not
need the SDK. Build, verify and import a pack before running this GPU test. The
NVIDIA device/driver determine which GPU build we can validate.

The current CUDA candidate uses whisper.cpp and GGML-format Tara. Transfer the
existing `models/ggml-tara-q8_0.bin` and `models/ggml-tara-q8_0.json` pair for that
test. CT2-format `model.bin` cannot be loaded by this CUDA plugin. Q5/Shruti are
not needed for the initial comparison.

After installing the verified CUDA pack and GGML Q8 model:

```powershell
.\scripts\benchmark-native-captions.ps1 -InputPath 'C:\clips\same-test.wav' -Model tara -Device cuda -Engine whisper-cpp -RequireCuda -Runs 3
```

The script rejects a missing CUDA pack before transcription, a CPU fallback, and
a GPU result without GPU-buffer evidence. Check actual utilization as well, using
NVIDIA telemetry or the compute/CUDA engine in Task Manager.

This compares the preferred CPU candidate against a GPU candidate, with different
engines/formats. To isolate CPU versus GPU within whisper.cpp, add a control run:

```powershell
.\scripts\benchmark-native-captions.ps1 -InputPath 'C:\clips\same-test.wav' -Model tara -Device cpu -Engine whisper-cpp -Runs 3
```

That control and the CUDA run use the same GGML Q8 artifact. Do not claim a pure
hardware speedup from CT2 INT8 versus whisper.cpp CUDA without noting the engine,
quantization and alignment differences.
