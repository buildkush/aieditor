# aiditor — Paste-ready context for another chat/agent

As of 8 November 2026. Workspace: `C:\kushagra\aiditor`. Read `AGENTS.md` and `docs/AIDITOR_HANDOFF.md` for the full handoff; detailed current caption docs are `docs/auto-captions.md` and `docs/speech-lab-tara.md`.

## Objective and architecture

We are building a local-first desktop video editor that humans can edit manually and future LLM/MCP agents can operate autonomously. Output must remain an editable project. React/TypeScript/Vite frontend, Tauri/Rust desktop, local Python speech workers.

ProjectState is the single source of truth. All timeline/project edits must use typed EditorCommands, including AI edits. Never mutate state directly, create a parallel AI timeline, overwrite source media or bypass the editor with a flattened video. Keep project state, serialized .aiditor files, immutable media and generated caches separate. Temporary projects are real projects.

The complete autonomous MCP editor, advanced tracking/masking and finished-video export are NOT established as complete. Inspect actual implementation before assuming a roadmap item is shipped.

## Work already done

- Editor foundation: project persistence/history, timeline editing/linked media, preview/playback, transforms, keyframes, audio, effects, captions.
- Canvas trackpad pinch/page-zoom handling, canvas-aligned transform controls, round corner/side/rotation handles, realtime Inspector sync and snapping. Do not casually remove the intentional browser/WebView zoom guard.
- Transition catalog deduplication and playback fixes, improved Digital Glitch, adjacent-clip linkage/alignment, live boundary-snapping drag previews and simplified Inspector. Disabled transition tab when absent.
- Extensive local Hinglish ASR experiments and CPU optimization; lab metrics/export fixes and timestamp/silence investigations.

## Current production auto captions

Only native Tara (Q8_0/Q5_0) and Shruti are supported. The Rust library in native/speech serves Tauri, CLI and MCP/HTTP. No Python, CT2 or separate agent timeline. See docs/native-captions.md.

## Current caption styling

Classic: Clean, Minimal, Bold, Meme, Highlight. Dynamic: Script Focus, Yellow Focus, Green Pill. Also Start from scratch / Custom.

Presets are editable starting configurations. Appearance and behavior are independent:
- All at once, progressive reveal, or one word at a time.
- Highlight off/current/spoken; text color, box or underline.
- Fixed emphasis word independent of timed highlighting, with editable font/color/size/width/tracking.
- Normal typography, background/radius/opacity/border/padding, outline and shadow controls.

Dynamic presets now default to progressive reveal. Existing saved captions retain settings; reapply a preset or edit Word appearance for the new default. Entire words/numbers (e.g. 2026) must not split internally. Yellow emphasis was widened. Fonts use local stacks/fallbacks.

Review styles apply to its full caption set. Inspector style changes now apply to ALL selected captions. Apply to all captions copies style/custom behavior to all current unlocked captions in one undo step. Preserve each caption's text/timing/emphasis choice. Rendering uses the same CaptionWords component for review and timeline; settings serialize with the project.

## Native Speech Lab and validation

Ctrl+Shift+L opens the native-only lab. Select Shruti and/or Tara Q8/Q5, prepare the same immutable source, and compare results and exports. Legacy model cards, VAD/chunking/keyword controls, Python environments and old experiments were removed. GPU packs are not published yet.

Run npm.cmd test, npm.cmd run build and native Cargo tests/builds. Current model/cache root: %LOCALAPPDATA%\com.aiditor.app\speech-lab. Use scripts/cleanup-legacy-speech.ps1 to remove prior installations while preserving native models and recordings.
