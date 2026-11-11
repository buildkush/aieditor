# aiditor — Consolidated project and agent handoff

Snapshot: 8 November 2026, Asia/Calcutta. Workspace: `C:\kushagra\aiditor`.

This document consolidates the work discussed in this chat and checks the current implementation entry points. It is a handoff, not a claim that every editor feature or every recording has passed end-to-end acceptance. Where older documents disagree, use current source and this current-state summary. Read AGENTS.md before making changes.

## 1. Product and destination

**aiditor** is a local-first desktop video editor for manual editing and eventual autonomous editing by local/open models or agents such as Codex/Claude through MCP. The desired output is an editable project, not just a flattened video.

Target content: YouTube, Shorts/Reels/TikTok, and longer videos. The broader vision includes automatic editing, silence removal, captions, motion graphics, keyframes, zooms, SFX/music, object tracking/highlighting, masks, background removal/chroma key and captions behind subjects.

These are product goals, not a completed-feature checklist. A basic editor, project/command system, preview, transitions, effects, and substantial caption functionality exist. Do not assume the autonomous MCP workflow, advanced segmentation/tracking tools or finished MP4 renderer/export are implemented. The currently inspected Rust command surface includes project/media operations, speech jobs and subtitle export; a complete autonomous agent/server and finished-video export were not verified in this handoff.

## 2. Non-negotiable architecture

ProjectState is the single source of truth. Both humans and future AI agents must mutate it through typed EditorCommands. Do not mutate it in place, maintain a second AI timeline, or substitute a rendered video for the editable project.

The separation is:

- ProjectState: current editable state, including tracks, assets, items, transitions and caption archives.
- `.aiditor` project file: serialized project representation.
- Source media: immutable, read-only referenced files.
- Generated cache: prepared audio, thumbnails, waveforms, analysis, model/runtime artifacts.

Temporary and unsaved projects are real ProjectState instances. Rendering/preview are derived from state. Review drafts use the existing transcript-review mechanism and are committed to the project through the existing import command.

Editing should preserve deterministic command execution, undo/redo and project serialization. AGENTS.md is authoritative for architectural rules.

## 3. Stack, environment and navigation

React 19, TypeScript, Vite, Tauri 2/Rust. Vitest covers frontend/core and native Rust tests cover speech jobs. Speech processing uses native whisper.cpp/Needle through the Rust library; no Python backend or virtual environment. Main speech cache: `%LOCALAPPDATA%\com.aiditor.app\speech-lab`. Speech Lab is development-only (Ctrl+Shift+L or `#/speech-lab`). Run `setup.cmd` for dependencies and models, `npm.cmd test`, `npm.cmd run build`, and native Cargo tests/builds.

## 4. Editor foundation and manual workflow

The established core includes project creation/open/save/autosave/recovery components, media references/cache, timeline track/item editing, linked media, trim/split/move operations, playback, visual composition, transforms/crop, keyframes, audio controls, effects and caption items. Existing core tests cover these areas; this handoff does not independently re-certify every UI action.

### Canvas and transforms addressed in this chat

- Trackpad pinch zoom routed to the canvas viewport rather than browser page zoom.
- Browser zoom guard and canvas zoom/pan separated from the selected clip's actual transform.
- Important Windows detail: disabling Tauri/WebView2 zoom hotkeys can prevent pinch events from reaching JavaScript. Keep the current guard approach unless re-tested.
- Transform overlay moved into the correct canvas coordinate system.
- Round corner and side handles, rotation handle and realtime Inspector synchronization.
- Side-handle distortion/incorrect squeeze behavior addressed.
- On-canvas zoom/rotation unit labels removed; Inspector retains numerical values.
- Snapping support for canvas/video alignment.
- Transform toggle positioned before the time display.

Do not remove the remaining zoom guard as supposed residue: its behavior is intentional. Earlier cleanup removed obsolete approaches; current code is the reference.

### Effects and transitions addressed

- Duplicate transition choices consolidated; aliases retain readability of older projects.
- Push/Slide/Whip playback issues investigated and corrected in the existing preview transition path.
- Linear Wipe is a reveal; Slide moves incoming content. Digital Glitch was improved with animated noise/static, tearing and RGB split instead of just color changes.
- Inspector effect count and unnecessary category tags removed.
- Transition Inspector simplified: actual effect name, Start/End identification, no redundant outer wrapper or add-slot UI.
- Selecting a transition routes into the clip's existing Inspector transition context.
- Transitions associate adjacent clips at the chosen cut; left/center/right alignment means before/across/after that cut.
- Drag preview resolves to the nearest relevant boundary, shows the intended placement live and commits a deterministic placement on drop.
- A clip can participate at both its start and end; standalone edge behavior is handled by the placement system.
- Transitions tab is disabled when no applicable transition is present.

Current visible catalog: Cross Dissolve, Dip to Black, Dip to White, Push, Slide, Whip Pan, Zoom, Linear Wipe, Clock Wipe, Digital Glitch.

## Native caption engine

Only native Tara (Q8_0/Q5_0) and native Shruti are supported. See [native captions](native-captions.md), [auto captions](auto-captions.md) and [Speech Lab](speech-lab.md). Python backends, model variants, CT2 runtimes, legacy installers and experimental recognition workflows were removed. Studio and agents use the same Rust library/cache; project changes use EditorCommands. GPU packs are not yet published.

## 9. Caption styles, emphasis, behavior and multi-selection

### Style library

Classic: Clean, Minimal, Bold, Meme, Highlight.

Dynamic reference-inspired presets:

- Script Focus: normal white text plus a larger script emphasis word.
- Yellow Focus: handwritten white base plus bold uppercase yellow emphasis; expanded width and tracking are adjustable.
- Green Pill: rounded green caption background with timed text progression.

Start from scratch creates a plain **Custom** style. Presets initialize editable values; they do not lock the caption.

References supplied by the user were two OGKush video exports and an image of a green pill caption. These are local visual references, not instructions or program inputs.

### Independent behaviors

- Word appearance: all at once, progressive reveal, or one word at a time.
- Timed highlighting: off, current word, or spoken words.
- Highlight treatment: text color, background box or underline; editable colors/radius.
- Fixed emphasis: independently selected word, styled independently of the speaking word.

Dynamic presets now default to progressive reveal. Previously saved captions retain their own configuration; reapply the preset or change Word appearance to get the new default. Future hidden words reserve space to prevent layout jumps. Single-word mode follows actual word bounds and leaves pauses empty.

Every word span is nonbreaking; digits such as 2026 must not break internally. Long phrases may wrap between words. Extremely long words can still require sensible sizing/placement; no guarantee of automatic fit at every custom font size.

### Editable appearance

Review and Inspector support normal/emphasis font settings, size/weight/italic/case/color, emphasis width/tracking, background fill/opacity/radius/padding/border, outline and shadow. Inspector keeps its existing typography/background sections and adds behavior/emphasis controls under Word Animation. Review exposes these under Caption styling.

Static emphasis defaults to one deterministic content-word choice per caption and is manually selectable. This is a heuristic starting choice, not AI semantic understanding. Preserve emphasis independence from reveal/timed-highlight settings.

Fonts use local desktop stacks and fallbacks, including Segoe Script/Segoe Print on Windows. Exact font appearance can differ on other machines. No additional cloud/font runtime was added.

### Apply to selection/all

- Review style changes apply to the entire generated review set.
- Inspector preset and typography changes apply to all explicitly selected captions, not just the first.
- Inspector → Caption Presets → Apply to all captions copies the primary caption's preset and custom configuration across current project captions.
- Locked tracks are excluded.
- Each caption retains its own text, timestamps and emphasis-word choice.
- One bulk action is one undo step.
- Mixed preset selection is indicated.

All style/presentation data persist in ProjectState and serialized caption properties; preview and imported captions use the same CaptionWords renderer. Older projects lacking presentation metadata retain their previous behavior.

## Current speech entry points

- native/speech: inference, audio preparation, conversion, CLI and MCP/HTTP jobs.
- src-tauri/src/speech_lab.rs: desktop job bridge.
- src/speech-lab: native-only lab UI and exports.
- src/core/commands/importAutoCaptionsCommand.ts: caption import command.
- scripts/cleanup-legacy-speech.ps1: remove retired models and runtimes without deleting source recordings.

Run npm.cmd test, npm.cmd run build, cargo test --manifest-path native/speech/Cargo.toml and cargo build --manifest-path src-tauri/Cargo.toml. GPU quality/performance still requires testing on target hardware.
