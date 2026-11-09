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

- Frontend: React 19, TypeScript, Vite; desktop: Tauri 2/Rust.
- Tests: Vitest for frontend/core; Python unittest for speech backend; Rust tests for desktop job boundaries.
- Speech processing: Python workers, isolated model-specific environments, local caches and native CPU runtimes.
- Main speech cache: `%LOCALAPPDATA%\com.aiditor.app\speech-lab`.
- Development Python environment in workspace: `.speech-lab-venv`.
- `npm.cmd` is the reliable npm entry point in this PowerShell environment.
- This workspace was inspected without a `.git` directory. Do not assume Git history/branches exist.
- Speech/Audio Lab is development-only, opened with Ctrl+Shift+L or `#/speech-lab`. Its code remains intentionally available.

Useful checks:

```powershell
npm.cmd test
npm.cmd run build
.\.speech-lab-venv\Scripts\python.exe -m unittest discover -s speech-lab/tests
# In src-tauri:
cargo test --lib captions_do_not_expose_development_lab_operations
```

The latest full frontend run passed 675 tests; the final affected-area run passed 75 tests; production build passed. The most recent backend integration run passed 114 tests, before the subsequent frontend-only style work. A Rust caption-operation allowlist test passed. Build still reports the existing large-bundle warning. Earlier lint attempts encountered a broken native oxlint binary; lint was not a substitute for the successful tests/build.

These counts are snapshot evidence, not expected permanent counts.

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

## 5. Speech-model work: history versus current choices

The lab began with local Whisper/Shruti experiments and grew into a manual comparison interface. Models/processes explored included Whisper variants, Whisper-tiny Hinglish, Srota, Shunya, original Whistle, several Shruti runtime/checkpoint variants, and Tara.

Problems investigated included incomplete long-recording transcription, chunking/token limits, isolated dependency compatibility, CPU performance, CSV exports selecting stale results, timestamp availability, and silence collapsing during preparation/alignment.

### Current production decision

| User option | Engine/configuration | Role |
|---|---|---|
| Quick mode unchecked (default) | Tara CPU INT8, speech-aware parallel | Main production auto captions |
| Quick mode checked | Shruti, Cactus Needle 3.2.10 | Faster alternative, potentially less accurate |

The Quick mode disclaimer intentionally does not name models. It says faster captions may be less accurate, especially English names and mixed-language speech. Technical documentation may name engines.

### Current Audio Lab selection

The retained selectable models are Shruti, Shunya CTranslate2 INT8, Whistle English, and Tara Speech-aware Parallel. Up to three cards can be selected; Run executes selected models sequentially. Tara parallelism is internal to its chunk processing, not concurrent execution of all selected models.

The lab supports imported audio/video, separate transcripts, available word timestamps, playback, metrics and individual/benchmark exports. Historical identifiers and results remain readable. Some experimental files/docs remain for future reuse. Do not interpret their presence as a currently supported model option.

Retired configurations include older Shruti instances, Shruti FP32, Srota, Whisper-tiny variants, Shunya PyTorch FP32 and Tara Original/Standard/single-worker comparison cards. Cleanup/removal work happened earlier; this handoff is not a fresh disk audit of every retired artifact. Tara's original checkpoint/runtime-source cache is intentionally retained where needed to verify/rebuild the shared conversion. Do not delete it as a duplicate runnable model.

### English recognition experiments

- Optional Whistle alternatives and English-correction suggestions were explored in the lab.
- Language-span reconciliation uses Hindi/English/uncertain/mixed spans, vocabulary/proper-name evidence, timing/context and Whistle English crops.
- Preserve Shruti originals; suggestions are not ground truth and must not rewrite surrounding Hindi.
- These experiments were not silently merged into production captions.
- Model weight tuning was discussed/explored with user-provided audio and verified scripts. No tuned Shruti checkpoint was promoted to production.
- Keywords helped some English terms but were not a general solution. Tara became the practical choice after user-run accuracy/speed comparisons.

Do not revive model variants, swap weights, add cloud inference or expand experiments without a concrete request.

## 6. Tara configuration and optimization

Canonical production/lab profile ID: `tara-int8-speech-aware-parallel`.

- Source: `Trelis/tara`, pinned revision `4dd4782d65ed8c9690b52478e4419d577fff40be`.
- Local asset manifest records Apache-2.0; preserve provenance/licensing when distributing.
- Converted model: CTranslate2 4.8.4, CPU `int8_float32`.
- Converted weights roughly 1.56 GB; original checkpoint roughly 3.09 GB.
- Hindi/English mixed-code decoder prefix preserved, including Tara's added mixed-code token.
- Greedy decoding; preserved tokenizer/preprocessing assets and alignment heads.
- Native runtime patched for Tara mixed-code prefix and its decoder-length needs.
- Release build optimization verified with `/O2 /DNDEBUG`.
- Avoid duplicate Intel OpenMP providers; do not use `KMP_DUPLICATE_LIB_OK` as a workaround.
- Two chunks concurrently, two CPU threads each, shared native model pool.
- One input chunk falls back to one worker/four threads.
- Bounded in-flight work, source-order assembly and cancellation through the owned process tree.
- Model unloads when the job ends; it is not kept permanently resident between edits.

The isolated Tara environment pins Torch 2.10.0+cpu and Transformers 4.46.3; see `tara.py` for the complete runtime pins. Do not casually upgrade Transformers or CTranslate2 independently of the custom native build.

### Speech-aware planning

Full prepared audio is scanned with the existing local Silero VAD asset. It guides variable-length chunks near pauses; chunk windows stay within the model's 30-second input budget. The planner aims around 26 seconds, searches meaningful pauses, and uses small context overlap at forced cuts.

Recognition retains the full original audio timeline, including silence. It does not simply concatenate all speech before ASR. Overlap reconciliation removes only conservative text-and-time-supported duplicates. Ambiguous hypotheses remain diagnosable rather than silently erased.

### Performance evidence, not promises

For one user-run 243.67-second video:

- Sequential speech-aware Tara: about 366.8 seconds.
- Parallel speech-aware Tara: about 304.6 seconds, approximately 17% less time.
- Those two runs produced identical text and word timestamps.
- A later parallel run took about 280.7 seconds; hardware/load/run variation matters.
- Observed peak RAM was around 3.4 GB.

These are specific local runs, not a benchmark guarantee or a general accuracy score. The user found Tara's Hinglish recognition substantially better for their product videos. Word coverage and complete audio-window coverage do not prove perfect transcription.

## 7. Word timing: root causes, recovery and final policy

Tara recognition and word timing are separate stages. Word timing uses the model's native attention/DTW alignment, not an LLM and not invented equal-duration word spacing.

Observed issue: a pause could be assigned to a neighboring word. Example: “ये” originally spanned 29.044–43.704 seconds. Speech-boundary constraints corrected the entry to approximately 43.588 seconds while preserving the 43.704 end.

The implemented stages are:

1. Native token-to-word timing with Unicode grouping and original chunk offsets.
2. Validate against detected speech regions; distinguish real speech evidence from 60 ms boundary padding.
3. For unresolved chunks, a bounded alignment-only retry compacts detected speech context, aligns the exact same tokens and maps times back through a reversible sample map. This does not rerun ASR or alter the transcript.
4. Limited short-word agreement checks retain an interval when native and compacted paths closely agree; this resolved the reported “ninety” case.
5. Preserve good neighbours and original data; export raw paths, interval constraints, adjustments and retry diagnostics.

**Final user-requested fallback:** if recovery cannot confidently repair a usable native interval, retain its original start/end and mark `timingNeedsReview: true` instead of hiding the time. UI displays Needs review and permits manual adjustment. An example “हैं” retained 8.000–8.120 seconds.

Do not regress to nulling all uncertain intervals. Also do not promise every word will always have a valid time: a genuinely absent/invalid native boundary or complete alignment failure can still be unavailable. Restoring a questionable interval improves usability, not demonstrated synchronization accuracy.

The review flag survives into production review/import metadata. Manually setting a review word's time clears its review marker while leaving the original recognition archive intact.

## 8. Production auto-caption flow

Entry: **File → Generate Auto Captions...**, separate from subtitle-file import.

1. Derive an audio plan from the active ProjectState.
2. Prepare the audible timeline mix with existing local audio decoding/cache. Respect offsets, gaps, source trims, speed/reverse, mute and evaluated gain; avoid double-mixing linked video audio.
3. Use Tara by default or explicit Quick mode/Shruti. No silent model fallback.
4. Open editable transcript review alongside the actual project composition/transport.
5. Review, edit and import using ImportAutoCaptionsCommand, producing normal editable caption timeline items and archived transcript metadata.

Engine setup/status follows the selected mode and reuses existing local model/runtime caches. No new model files were downloaded during the production integration; both were confirmed installed locally then. Jobs remain cancellable; audio preparation is not duplicated for Tara.

### Output language

- Hinglish: existing local Roman Hindi converter maps Devanagari into Latin spelling while retaining English tokens.
- Hindi: preserve native mixed-script output.

The converter is deterministic rules/dictionaries plus transliteration, not another AI model. It is not limited to the sample recordings, but its dictionaries and Roman spelling choices are imperfect. Keep native transcript/timing internally. Switching output format does not rerun ASR, translate or paraphrase.

Production keyword and remember-keywords controls were removed. Archived metadata remains readable; lab keyword experiments remain separate.

### Review and pacing

- Wide responsive dialog, larger video/composition preview and editable list.
- Fixed bottom Cancel/Retry/Import actions, collapsible styling.
- Project playhead drives preview and highlights; avoid a second playback clock or duplicate audio player.
- Caption text/timing edits, per-word timing, insertion/deletion, split/merge, frame nudges, styling, undo/redo, retry with keep-edits/use-new choice.
- Words per Caption: Auto or 1–5. Portrait Auto generally favors two words with readable exceptions; landscape retains broader phrase pacing; square/other ratios use sensible intermediate defaults.
- Respect pauses and phrase readability rather than enforcing counts blindly.
- Native transcript, original alignment diagnostics and reviewed result remain distinguishable.

File → Export Captions exports edited visible timeline captions to SRT/VTT. These formats do not carry the full visual style; the project retains the editable styled captions. Existing subtitle-file import remains available.

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

## 10. File/module map

Paths below are relative to `C:\kushagra\aiditor`.

| Area | Main files |
|---|---|
| Rules / state | AGENTS.md; src/core/project/projectState.ts; src/store/projectStore.tsx |
| Commands / history | src/core/commands/editorCommand.ts; projectCommands.ts; commandHistory.ts |
| Persistence | src/core/persistence/projectSerializer.ts; projectFileSchema.ts; projectLoader.ts; autosave.ts |
| Editor entry / menus | src/App.tsx; src/components/editor/EditorShell.tsx; MenuBar.tsx |
| Canvas zoom / transform | src/browserZoom.ts; src/components/preview/PreviewPanel.tsx; previewWheel.ts; CanvasTransformOverlay.tsx; transformGeometry.ts; canvasSnapping.ts |
| Composition / playback | src/components/preview/VideoLayerItem.tsx; AudioLayerItem.tsx; usePlayer.ts; src/core/playback/timelinePlayback.ts |
| Transitions | src/core/timeline/transitionDefinitions.ts; transitionPlacement.ts; transitionAlignment.ts; src/core/playback/transitionEvaluation.ts; preview/GlitchFilter.tsx |
| Production caption UI | src/components/captions/AutoCaptionsDialog.tsx; TranscriptReview.tsx; CaptionWords.tsx; CaptionStylePicker.tsx; CaptionCustomization.tsx |
| Caption domain / draft | src/core/captions/types.ts; projectAudioPlan.ts; transcriptReview.ts; reviewEditing.ts; captionStyles.ts; romanHindi.ts |
| Caption mutation / export | src/core/commands/importAutoCaptionsCommand.ts; captionStyleCommands.ts; src/core/subtitles/projectCaptionExport.ts; src/services/exportCaptions.ts |
| Caption worker bridge | src/services/autoCaptions.ts; speechWorker.ts; src-tauri/src/speech_lab.rs |
| Production Python router | speech-lab/backend/auto_captions.py; worker.py; project_audio.py; audio.py |
| Tara | speech-lab/backend/tara_int8.py; tara_alignment.py; tara_chunking.py; tara.py; tara-assets.json; scripts/build_tara_int8.py |
| Shruti | speech-lab/backend/shruti_transcription.py; shruti_runtime.py; shruti-assets.json |
| Lab UI / metrics | src/speech-lab/ui/SpeechLab.tsx; services/modelComparison.ts; evaluation.ts; types.ts |
| Experimental reconciliation | docs/speech-lab-language-spans.md and corresponding lab services/backend modules |
| Detailed current caption docs | docs/auto-captions.md; docs/speech-lab-tara.md |

Some filename/path labels in older experimental documents are historical. Check filesystem and current registrations before reusing them.

## 11. Known limits and remaining acceptance work

1. Full app vision is unfinished. Do not claim autonomous MCP editing or production video export just because commands/preview exist.
2. Tara remains computationally substantial on CPU. No GPU optimization or Oracle/cloud deployment was shipped in this work.
3. Speech recognition and alignment remain imperfect; retained Needs review intervals can be wrong, long or overlapping. Keep raw diagnostics and manual controls.
4. New caption configurations have automated coverage, but are not proven across every recording, font, project ratio or packaged machine.
5. Development UI builds and local runtime availability are not proof of a distributable installer with all native dependencies. Tara installation/build provenance and licensing need attention before public distribution.
6. Reference-based styles are inspired reproductions, not a guarantee of matching proprietary reference fonts exactly.
7. Read older documentation cautiously: “Shruti-only production,” two selectable Tara profiles, prior keyword UI and retired model instructions can be historical.
8. Do not reintroduce duplicate runtimes, reconvert verified weights unnecessarily, overwrite source media, or delete shared caches needed by the retained lab.
9. A complete model-cleanup disk audit was not rerun for this report. A model being hidden/retired is not proof that every old file is absent.

## 12. Recommended continuation procedure

- Read AGENTS.md and this report, then inspect the relevant current modules.
- Confirm the next concrete user task; do not independently implement the full product vision.
- Preserve CPU/local-first behavior and the Tara default / explicit Quick mode choice.
- Use the same typed commands for human and AI edits, including bulk caption styles.
- Test behavior, undo/redo and serialization as relevant; do not only test markup.
- For ASR changes, use mocks/saved outputs for automated tests unless real inference is explicitly requested. The user has historically run their own recordings manually; do not launch surprise benchmarks/training.
- When evaluating recordings, distinguish transcript accuracy, timestamp coverage and actual synchronization. They are different metrics.
- Keep generated artifacts in caches, remove your own temporary fixtures and leave user media unchanged.

The user prefers direct implementation, consistent existing UI patterns, concise progress updates and few unnecessary confirmations. They want reusable editable output and practical control rather than hidden automation or model-specific UI clutter.
