# Development on another Windows PC

Run a separate development checkout on each computer. Git synchronizes source;
dependencies, model weights, footage and generated caches stay on each machine.
The desktop app and its native workers execute on the PC where they are launched.
Opening a frontend served by another PC does not move browser computation or
Tauri workers to that PC.

## One-command setup

From a cloned checkout on Windows x64, run:

```powershell
.\setup.cmd
```

The command checks Git, Node.js/npm, C++ tools/Windows SDK, WebView2, Python and
Rust. Missing system prerequisites are installed through WinGet; Windows may
request administrator approval. WinGet itself comes from Microsoft's **App
Installer**. If it is missing, install/update App Installer from the Microsoft
Store and rerun setup. If Windows requests a restart, restart and rerun setup.

Setup then installs npm dependencies from `package-lock.json`, fetches the locked
Cargo dependencies, prepares the pinned Python environment and installs both
current caption modes: Tara and Shruti. It handles Tara's isolated CPU runtime,
custom native build and INT8 conversion in order. Existing verified weights and
native runtimes are reused; no recording is transcribed or benchmarked.

The first setup needs internet and several GB of free space for model weights,
Python/native dependencies and intermediate build files. Close aiditor before
running installation/repair. Failures stop setup and show the step to repair;
rerunning reuses completed installations. Setup does not install NVIDIA drivers,
CUDA, segmentation/tracking models or a remote GPU worker. Existing caption
profiles remain CPU configurations.

| Command | Scope |
| --- | --- |
| `.\setup.cmd` | App, speech dependencies, Tara and Shruti |
| `.\setup.cmd -Models Tara` | App, speech dependencies and Tara only |
| `.\setup.cmd -Models Shruti` | App, speech dependencies and Quick mode only |
| `.\setup.cmd -Models None` | App and speech dependencies, no model weights |
| `.\setup.cmd -AppOnly` | Desktop app dependencies, no Python/speech setup |
| `.\setup.cmd -Check` | Check prerequisites, dependencies and selected models without installing |
| `.\setup.cmd -SkipSystemInstall` | Install project dependencies/models only; fail if a system prerequisite is missing |
| `.\setup.cmd -Launch` | Complete setup and launch the desktop development app |

After Node.js is available, `npm.cmd run setup -- -Check` invokes the same script.
The batch launcher works before Node.js is installed and from paths with spaces.
It bypasses PowerShell execution policy for that invocation only; it does not
change machine-wide policy. Check mode does not create model manifests/downloads
or install missing packages. It returns a failing exit code for incomplete setup.

## Prerequisites (manual alternative)

- Git for Windows.
- Node.js 22.18 or newer with npm. This checkout has been developed with Node 22.18.
- Rust 1.90 or newer, using the Windows MSVC toolchain.
- Visual Studio Build Tools with **Desktop development with C++**, including a
  Windows SDK.
- Microsoft Edge WebView2 Runtime.
- For local speech processing: Python 3.12 or 3.13 x64 (Python 3.13 tested).

Follow the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/#windows)
for native build tools. A normal frontend-only session does not require Rust,
C++ tools or Python; the desktop build and local speech workers do.

## First clone and launch

After the repository has been pushed, run these commands in PowerShell on the
destination PC. Replace `YOUR_REPOSITORY_URL` with your repository's clone URL.

```powershell
git clone YOUR_REPOSITORY_URL aiditor
Set-Location aiditor
.\setup.cmd
.\run-desktop.bat
```

The first native build downloads Cargo dependencies and compiles the desktop app.
For later launches, `run-desktop.bat` runs the same desktop development command.

For a browser-only UI session, use `npm.cmd run dev` and open the URL it prints.
Current local speech processing requires the desktop app; serving Vite on a LAN
does not expose a remote model-processing service.

## Manual speech setup

The main setup command already performs this step. For an existing manual setup,
the following installs only pinned base Python dependencies, not model weights:

```powershell
powershell -File .\scripts\setup-speech-lab.ps1
```

The script creates `.speech-lab-venv` in this checkout. If Windows blocks an
internet-downloaded script, review it and unblock that file rather than changing
the machine-wide execution policy. Installation failures should be fixed on the
destination PC; do not copy a virtual environment from another computer.

To complete model setup from the command line, use `.\setup.cmd -Models Tara`,
`-Models Shruti` or `-Models Both`. The app also retains its model-installation
controls. Tara's production CPU path needs its separately managed runtime and
custom native build; the base Python script alone is not the complete Tara
installation. The main setup command runs the additional steps automatically. See
[Tara setup and runtime notes](speech-lab-tara.md) and
[the native build script](../scripts/build_tara_int8.py). That script clones the
pinned CTranslate2 source into the ignored `speech-lab/research/` directory when
it is missing and applies the versioned patches itself.

Speech Lab is available only in development builds (Ctrl+Shift+L). Downloaded
models and runtime caches normally live under
`%LOCALAPPDATA%\com.aiditor.app\speech-lab`; they are separate from the repository.
Do not copy those runtime environments between PCs. Transfer immutable model
assets separately only when the relevant installer supports verifying/reusing
them.

## Updating the second PC

Commit and push reviewed changes from the development machine. On the second PC,
stop the app and run:

```powershell
git status
git pull --ff-only
.\setup.cmd
.\run-desktop.bat
```

Resolve or commit local work before pulling; do not discard it automatically.
Re-run Python setup when its dependency lockfile changes. New GPU experiments
should use separate environments so they do not replace the existing speech
dependencies. Merely having an NVIDIA GPU does not enable GPU execution in a
CPU-configured model runtime.

## Repository contents

Commit source code, tests, documentation, application images/icons, configuration,
`package-lock.json`, `src-tauri/Cargo.lock` and Python requirement files.

The root `.gitignore` excludes dependencies, build output, virtual environments,
downloaded research checkouts, weights, recordings, `.aiditor` projects, renders,
archives, local credentials and temporary output. These rules do not delete files.
Keep footage outside the checkout or in an ignored `media/` or `recordings/`
directory. Existing projects may need their source files relinked on another PC.

Small, intentional binary test fixtures that match an ignore rule can be added
with a narrow exception after review. Do not force-add a model cache or a whole
media directory. Ordinary source images and icons are not ignored.

Review prospective Git content before the first commit:

```powershell
git status --short
git add --dry-run .
git check-ignore -v .env node_modules/ .speech-lab-venv/ src-tauri/target/ speech-lab/research/
```

Check documentation and benchmark reports for information you do not want to
publish. An ignore file prevents new matching files from being added normally;
it does not remove files or secrets already committed to history.

## Validation

```powershell
npm.cmd test
npm.cmd run build
```

With the speech environment installed, backend unit tests use mocks and synthetic
fixtures and can be run without transcribing personal recordings:

```powershell
.\.speech-lab-venv\Scripts\python.exe -B -m unittest discover -s speech-lab/tests -p "test_*.py"
```

Setup orchestration tests use mocks, without installing packages or models:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/test-setup.ps1
.\.speech-lab-venv\Scripts\python.exe -B -m unittest discover -s speech-lab/tests -p "test_setup_models.py"
```

Real model inference, recording benchmarks and GPU compatibility checks are
separate, explicitly selected experiments. Segmentation/tracking integration and
a remote GPU worker are not implemented by this setup.
