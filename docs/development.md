# Development on another Windows PC

Each PC runs its own checkout. Git synchronizes source; dependencies, model
weights, media and generated caches remain local. A browser opened on another
PC does not move computation to that PC.

## First clone and setup

On Windows x64, install Git and clone the pushed repository. Windows App Installer
provides WinGet, which setup uses for missing system prerequisites.

```powershell
git clone YOUR_REPOSITORY_URL aiditor
Set-Location aiditor
.\setup.cmd
.\run-desktop.bat
```

Setup checks/installs Node.js 22.18+, Rust 1.90+ MSVC, C++ Build Tools/Windows SDK,
WebView2, CMake and FFmpeg. It installs npm dependencies from the lockfile,
fetches locked Rust dependencies, builds the native caption CLI and prepares
Tara GGML plus native Shruti. It does not run Python, pip, or create a virtual
environment. Windows may request administrator approval. If an installer requires
a restart, restart and rerun setup. If WinGet is missing, install/update Microsoft
App Installer from the Microsoft Store first.

The first setup needs internet, build time and several GB of free disk space.
Tara currently converts a pinned source checkpoint locally with Rust; it is not
yet a small preconverted download. Existing verified weights are reused. Close
aiditor before installation/repair. No recording is processed during setup.

| Command | Scope |
| --- | --- |
| `.\setup.cmd` | Native app/CLI dependencies, Tara and Shruti |
| `.\setup.cmd -Models Tara` | Tara only |
| `.\setup.cmd -Models Shruti` | Shruti Quick mode only |
| `.\setup.cmd -Models None` | Native app/CLI, no model weights |
| `.\setup.cmd -AppOnly` | Desktop dependencies, no CLI/model preparation |
| `.\setup.cmd -Check` | Read-only prerequisite/dependency/model checks |
| `.\setup.cmd -SkipSystemInstall` | Fail if a system prerequisite is missing |
| `.\setup.cmd -Launch` | Set up and launch the desktop development app |

After Node.js is installed, `npm.cmd run setup -- -Check` invokes the same script.
The launcher applies PowerShell execution-policy bypass only to its process.

See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/#windows) for
manual system-tool installation. For a frontend-only UI session use
`npm.cmd run dev`; local inference uses the desktop app or native CLI.

## Native caption models and GPU status

The model/cache root is `%LOCALAPPDATA%\com.aiditor.app\speech-lab`.
The native CLI is `native\speech\target\release\aiditor.exe` after setup. Models,
recordings and cache output are not committed. Source media is immutable.

Read [Native caption engine](native-captions.md) for conversion, CLI/MCP usage,
model-format differences and validation limitations. The current acceleration
pack catalog is empty: setup detects hardware but reports CPU fallback until a
tested compatible pack is published and pinned. It does not install GPU drivers
or GPU SDKs. Do not infer acceleration merely from an NVIDIA GPU being present.

Only native Tara and Shruti are supported. To remove a previous Python installation and retired model weights, close aiditor and run `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/cleanup-legacy-speech.ps1`. This preserves native GGML/Needle models and source recordings.

## Updating the second PC

For the current fast CT2 CPU build, use [the existing-installation update guide](update-existing-installation.md).
It covers the one-time verified native asset transfer and reuse of older caches.
An old GGML model or Python environment does not provide this CT2 runtime.

Commit and push reviewed work from the development PC. On the other PC, stop the
app and run:

```powershell
git status
git pull --ff-only
.\setup.cmd -SpeechBundle "D:\aiditor-native-speech"
.\run-desktop.bat
```

Commit or resolve local work before pulling; do not discard it automatically.
After the initial transfer, future source-only updates can use plain `setup.cmd`;
unchanged native model/runtime files are reused. Q5 is not a default download.
A packaged release should not require users to install build tools. This is a
source-development setup; packaged-size and clean-machine release testing remain
separate work.

## Repository contents and checks

Commit source, tests, application images/icons, configuration, documentation,
JavaScript/Cargo lockfiles and pinned native source/licenses. `.gitignore` keeps
build output, downloaded weights, personal projects/media, temporary data,
archives and credentials out of normal Git additions. It does not delete files
or remove anything already committed. Transfer/relink source media separately.

```powershell
git status --short
git add --dry-run .
npm.cmd test
npm.cmd run build
cargo test --manifest-path native/speech/Cargo.toml --lib
cargo build --manifest-path src-tauri/Cargo.toml
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-setup.ps1
```

No real recording is transcribed by these unit tests. GPU latency/quality tests
require an explicitly selected fixture and the actual target hardware.
