# aiditor

An AI-native, local-first desktop video editor designed to be controlled by both humans and AI agents.

## Run the development app

**Updating a PC with older models?** Follow [Update an existing installation](docs/update-existing-installation.md).
Use `setup.cmd -SpeechBundle "D:\aiditor-native-speech"` for the current CT2 CPU
configuration; pulling Git alone does not install that unpublished runtime/model.

On Windows x64, clone the repository and run:

```powershell
.\setup.cmd
.\run-desktop.bat
```

Setup installs missing prerequisites through WinGet, app/native dependencies,
and both current caption modes (native Tara and Shruti), with no Python or pip.
The first run needs internet,
several GB of disk space, and may show Windows administrator prompts. It reuses
verified cached models and runs no transcription. Use `.\setup.cmd -AppOnly`
to skip speech setup, or `.\setup.cmd -Check` for a read-only readiness check.

See [Native caption engine](docs/native-captions.md) for model conversion, agent
CLI/MCP access, GPU-pack status and migration limitations.

The new [native runtime foundation](docs/native-runtime.md) adds an optional
Python-free CTranslate2 CPU backend, portable capability probes, and bounded chunk
scheduling. Published standalone acceleration/model packs are still being prepared;
the source-development setup above remains separate from the end-user installer.

For a second PC, follow [CPU first, then GPU benchmarking](docs/test-second-machine.md).
Git does not transfer the locally cached CT2 runtime or model weights.

For a frontend-only browser session after dependencies are installed, use
`npm.cmd run dev`. Current local speech workers require the desktop app.

See [Development on another Windows PC](docs/development.md) for first-clone
instructions, speech setup, updating a second PC, and what belongs in Git.

## Vision

aiditor aims to make professional-quality content creation accessible through both traditional manual editing and AI-assisted editing.

The long-term goal is an editor where an AI agent can understand and manipulate the same project and timeline that a human editor uses.

## Target Use Cases

- YouTube videos
- YouTube Shorts
- Instagram Reels
- TikTok
- Other short-form and long-form content

## Long-Term Capabilities

aiditor is intended to eventually support:

- Timeline editing
- Automatic cutting
- Dead-air removal
- Captions
- Stylized captions
- Motion graphics
- Keyframe animation
- Zooms
- SFX
- Music
- Object tracking
- Object highlighting
- Masks
- Captions behind subjects/objects
- Background removal
- Chroma key
- AI-assisted editing
- MCP-based AI agents

## Core Principle: Project-First Architecture

> ProjectState is the single source of truth, and every editing operation happens within a ProjectState.

There is never a separate "AI editing state" or detached temporary timeline. Both humans and AI agents act as clients to the exact same project lifecycle:

```text
Human
  ↓
Editor UI
  ↓
Editor Commands
  ↓
ProjectState
  ├──→ Preview
  └──→ Renderer

AI Agent
  ↓
MCP
  ↓
Editor Commands
  ↓
ProjectState
```

The rendered video is not the project source of truth. Temporary and unsaved projects are real ProjectState instances backed by local application data storage, maintaining clean separation between project state, project files, immutable source media, and generated cache data.

## Technology

The initial technology stack is planned to use:

- TypeScript
- React
- Vite
- Tauri
- Rust
- FFmpeg

The project is intended to be local-first and open-source.

## Development Philosophy

aiditor should be built as a real editor platform rather than a collection of AI features around a traditional video editor.

The architecture should prioritize:

- Structured project data
- Non-destructive editing
- A robust timeline model
- Undo/redo
- Human and AI interoperability
- Replaceable rendering infrastructure
- Local processing
- Open-source technologies

## Current Status

Active development. Project persistence, command history, timeline editing,
preview, transforms, keyframes, effects and editable captions are implemented.
The complete autonomous MCP workflow, general object tracking/segmentation and
finished-video export remain under development. Product vision lists describe
the intended scope, not a completed-feature checklist.
