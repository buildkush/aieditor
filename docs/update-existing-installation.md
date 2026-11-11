# Update an existing Windows installation to the current native CPU build

The current CPU configuration is **Tara Automatic -> native CTranslate2 INT8/MKL**,
plus native Shruti for Quick mode. Q5 is an optional lower-memory mode; setup and
the transfer bundle do not install it by default. CUDA/Vulkan packs remain a
separate, unfinished hardware-validation step.

Git updates code and lockfiles. It deliberately does not transfer weights,
compiled runtime packs, recordings, projects, dependencies, or build output.
An old GGML Tara or Python CT2 installation alone is not the new native CT2 setup.

## 1. Commit and push the source from the working PC

Review the changes, then use VS Code Source Control or:

```powershell
git status --short
git add --dry-run .
git add -A
git commit -m "Add native caption runtime and verified update tooling"
git push origin main
```

The vendored `native/whisper-rs-sys` tree contains required C/C++ build source and
licenses, not installed models. It legitimately adds hundreds of source files.
The `transfer` folder, model binaries, Python/build caches, media and generated
artifacts are ignored. Never force-add the transfer folder or weights.

## 2. Transfer the current CPU assets once

A verified handoff folder has been prepared on this working PC:

```text
transfer/aiditor-native-speech/
```

It contains about 1.95 GB of CT2 Tara, its native runtime and the small preprocessing
asset. It contains no source recordings, projects, Python environment, original
safetensors, Q5/Q8 models, compiler SDK, or Rust/npm build trees. Copy this folder
to the other machine using a drive or your local network, outside Git.

To create another fresh copy later, close speech jobs and run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/export-native-speech.ps1 -Destination "D:\aiditor-native-speech"
```

Choose a new or empty destination. Export never deletes an existing folder. Files
are checked against the native model/runtime manifests, copied with SHA256/size
verification, and described in `bundle-manifest.json`.

## 3. Update the i5/GPU PC

Stop its running development server/app and speech jobs. Preserve or commit local
source changes before pulling; do not reset or delete that checkout.

```powershell
git status --short
git pull --ff-only
.\setup.cmd -SpeechBundle "D:\aiditor-native-speech"
.\run-desktop.bat
```

Use the actual copied folder path. This command updates npm/Cargo dependencies
from lockfiles, builds the current native CLI, imports the verified CPU assets,
then prepares the requested models. Matching destination files are reused by
SHA256/size; changed files are replaced atomically and ready markers are written
last. Bundle validation completes before any active model file is changed.

Existing valid Shruti files are reused. Existing GGML Q8/Q5 weights remain available
for separate tests; they are not treated as CT2 weights and are not converted or
redownloaded unnecessarily. The original Tara checkpoint and MKL build SDK are
not downloaded for the transferred CT2 runtime. The normal source-development
toolchain is still required to build the app; this is not the standalone installer.

Import can also be run separately after updating:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/import-native-speech.ps1 -Source "D:\aiditor-native-speech"
```

## 4. Confirm the update in the UI

Open Speech Lab, select only **Tara Native · Automatic**, select **CPU**, and use
the same audio. Metrics must report `ctranslate2` and `int8_float32`. Export the
benchmark JSON. A four-thread layout is not forced: available cores, chunks and
memory determine its worker budget.

For a native load/integrity check without transcribing any recording:

```powershell
.\native\speech\target\release\aiditor.exe models verify tara --engine ctranslate2
```

GPU selection does not create CUDA support. Keep the second PC's existing GGML
Q8 pair for the later CUDA test, and follow [CPU then GPU testing](test-second-machine.md)
when a compatible verified GPU pack is ready.

## Later source updates

Once the native CT2 assets are installed, ordinary updates are:

```powershell
git pull --ff-only
.\setup.cmd
.\run-desktop.bat
```

The existing verified CT2/Needle assets are reused. Transfer a new bundle only
when its model/runtime version changes or an integrity check fails. A frontend
refresh alone cannot replace already-loaded native Rust/C++ code: restart the
development app after updating.

## Cleanup

After the new configuration is verified, preview cleanup before executing it:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/cleanup-legacy-speech.ps1 -CurrentOnly -RemoveBuildInputs -WhatIf
```

Remove `-WhatIf` only when the listed targets are the intended obsolete files.
This checks the active CT2 assets first, refuses active speech jobs, linked paths
and media-containing directories, preserves benchmark evidence and the optional Q5
cache, and removes unused GGML Q8 only when no GPU pack is installed. Do not use
`-CurrentOnly` on the GPU test machine if you want to retain Q8 for the upcoming
test. No cleanup is performed automatically by setup or import.
