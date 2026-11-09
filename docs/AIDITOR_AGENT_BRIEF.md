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

File → Generate Auto Captions uses **Tara by default**. **Quick mode** explicitly uses **Shruti** with a less-accurate warning; user-facing disclaimer must not name models. No silent fallback. Production keyword controls were removed.

Tara = Trelis/tara converted CTranslate2 4.8.4 CPU int8_float32, speech-aware variable chunks, two workers × two threads, one-chunk fallback to one × four. Profile ID: tara-int8-speech-aware-parallel. Reuse existing conversion/cache/custom optimized native runtime; do not reconvert or upgrade dependencies casually. Model releases at job end. Approximately 1.56 GB converted weights and ~3.4 GB observed runtime RAM; speed depends on recording/machine.

Shruti = cactus-needle 3.2.10 / native engine 3.3.3. Both engines use the same prepared timeline mix. Preserve gaps, offsets, trim, speed/reverse and mute/gain. Review/import uses the existing ImportAutoCaptionsCommand and ProjectState caption architecture.

Native mixed-script output is preserved. Hinglish output uses the existing deterministic Roman Hindi converter, not another AI model. Script switches must not rerun ASR or change word times.

Timing = native attention/DTW plus speech constraints, bounded alignment-only recovery and diagnostics. Crucial final policy: if a questionable native interval cannot be repaired, KEEP its original usable start/end and mark timingNeedsReview, rather than nulling it. User prefers editable imperfect values. Actual missing/invalid native alignment can still be unavailable. Never promise perfect synchronization or fabricate ASR times.

Review supports wide video/list layout, edits, per-word timing, split/merge, insertion/deletion, undo/redo, retry choices, style controls and pacing Auto/1–5 words. Portrait Auto favors ~2 words, landscape broader phrases. Export Captions saves edited SRT/VTT; visual styling remains in the project.

## Current caption styling

Classic: Clean, Minimal, Bold, Meme, Highlight. Dynamic: Script Focus, Yellow Focus, Green Pill. Also Start from scratch / Custom.

Presets are editable starting configurations. Appearance and behavior are independent:
- All at once, progressive reveal, or one word at a time.
- Highlight off/current/spoken; text color, box or underline.
- Fixed emphasis word independent of timed highlighting, with editable font/color/size/width/tracking.
- Normal typography, background/radius/opacity/border/padding, outline and shadow controls.

Dynamic presets now default to progressive reveal. Existing saved captions retain settings; reapply a preset or edit Word appearance for the new default. Entire words/numbers (e.g. 2026) must not split internally. Yellow emphasis was widened. Fonts use local stacks/fallbacks.

Review styles apply to its full caption set. Inspector style changes now apply to ALL selected captions. Apply to all captions copies style/custom behavior to all current unlocked captions in one undo step. Preserve each caption's text/timing/emphasis choice. Rendering uses the same CaptionWords component for review and timeline; settings serialize with the project.

## Lab and retained/retired experiments

Keep Audio/Speech Lab code for future reuse. Development entry: Ctrl+Shift+L or #/speech-lab. Select up to 3 cards and run sequentially. Retained choices: Shruti, Shunya INT8, Whistle English, Tara Parallel. Whistle English/language-span reconciliation remains experimental, not production auto-merge. No tuned Shruti weights were promoted.

Older Shruti variants, Srota, Whisper-tiny, Shunya FP32, Tara Original/Standard/single-worker cards were retired. Historical files/IDs/docs may remain. Original Tara source assets may still be needed for conversion verification. Hidden model != proof all files were physically deleted. Avoid duplicate runtimes and do not delete shared artifacts as residue.

## Entry points and validation

- `src/components/captions/AutoCaptionsDialog.tsx`, `TranscriptReview.tsx`, `CaptionCustomization.tsx`, `CaptionStylePicker.tsx`, `CaptionWords.tsx`.
- `src/core/captions/{types,captionStyles,reviewEditing,transcriptReview,projectAudioPlan}.ts`.
- `src/core/commands/{editorCommand,captionStyleCommands,importAutoCaptionsCommand}.ts`.
- `src/services/autoCaptions.ts`; `src-tauri/src/speech_lab.rs`.
- `speech-lab/backend/{auto_captions,worker,project_audio,tara_int8,tara_chunking,tara_alignment,shruti_transcription}.py`.
- Model/runtime cache: `%LOCALAPPDATA%\com.aiditor.app\speech-lab`.

Latest full frontend suite: 675 passed; latest affected-area check: 75 passed; build passed. Latest backend production integration check: 114 passed (before later frontend-only style work). Rust allowlist check passed. Existing bundle-size warning remains. Workspace currently has no .git directory. Use npm.cmd on Windows.

Do not automatically transcribe/benchmark/train on user recordings; they have been manually testing. Prefer mocks and replayed saved output unless real inference is requested. Distinguish accuracy, timing coverage and actual sync. Respect current user direction, make changes directly, avoid unrelated refactors and unnecessary approval questions.
