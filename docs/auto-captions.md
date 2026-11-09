# Generate Auto Captions

Open a project and choose **File → Generate Auto Captions...**. This is a File action separate from **File → Import → Subtitle File…**, whose existing behavior is unchanged.

Use **File → Export Captions...** to save current timeline captions as `.srt` or `.vtt` through the desktop Save dialog. Export uses edited caption text and timeline positions from visible tracks, sorted chronologically, preserving Unicode, line breaks and gaps. It does not regenerate transcription or alter the project. The action is disabled when there are no visible captions. In browser previews it downloads an SRT file.

The compact setup offers:

- **Hinglish**: the existing local Roman Hindi converter writes Hindi in Latin letters and leaves literal English spelling/case unchanged.
- **Hindi**: the selected engine’s native Hindi and English script/spelling are retained.

**Tara is the main caption engine.** Generate captions with Quick mode unchecked
to use the existing CPU INT8, speech-aware, parallel Tara configuration. Check
**Quick mode** to use Shruti instead. The dialog explains that Quick mode is
faster but may be less accurate, particularly for English names and mixed speech.
The user-facing disclaimer does not name either model.
There is no silent fallback to Quick mode. Setup/installation status follows the
selected mode and reuses the existing model cache and isolated runtime.

Both engines receive the same prepared project mix, retaining timeline offsets,
muting, trims, speed/reverse, gain and silence. Tara uses two chunk workers with
two threads each and its existing DTW/pause recovery. Shruti keeps its existing
pause-preserving production adapter. Jobs remain local, offline after setup, and
cancellable through the existing owned worker process tree.

Production setup contains output format, Words per Caption and Quick mode. The
old keyword/remember-keywords controls and production hint plumbing were removed.
Historical transcript keyword metadata remains readable. Language/script selection
is still a presentation setting, not a model switch or a translation step.

Uncertain original Tara word intervals remain available, flagged **Needs review**.
Review shows a notice and per-word markers; manually setting a word’s timing
clears its review marker while retaining the original recognition/diagnostics.
Import continues through `ImportAutoCaptionsCommand` and `ProjectState`, and
transcripts record the engine used. Subtitle-file import is unchanged. Audio Lab
and its comparison/model code remain available for later work.

Review shows the actual project video/composition using the existing PreviewPanel and player beside a compact, scrollable caption list. Each selected caption has one editable text field and start/end controls; per-word controls live under **Word timing & emphasis**. Click a caption or use Previous/Next to seek, play a single caption, or use the regular transport. The progress bar also supports Home/End, Left/Right for a frame, and PageUp/PageDown for a second. Caption and active-word highlighting are derived exclusively from `ProjectState.playheadTime`; the review has no separate audio or animation clock. The main editor's preview is unmounted while the review preview is active, avoiding duplicate audio players. Caption playback tightens media drift correction to 60 ms in project time, scaled by clip playback speed, without repeatedly seeking an element already seeking.

Text edits, missing-word insertion, Add caption at the playhead, Delete, Split at the text cursor, Merge next, timestamp edits, per-word timing and one-frame nudges all work before import. Adding inside an occupied cue suggests the next free interval. Invalid timing, overlapping cues and out-of-audio bounds are rejected. Unchanged words retain their IDs, timestamps and emphasis when text changes, using token sequence matching; user-authored new words receive editable timing in the available interval without redistributing original ASR word timing. Original ASR data stays immutable. Manual retiming changes draft timing only; it never changes `nativeWords` or raw responses.

Change language at any time without transcription. Native and Roman edits are independent; changing a native word invalidates its stale Roman override. Review edits have undo/redo, including script/style changes and explicit retry replacement. **Retry** leaves the current review intact until recognition succeeds and the user chooses **Use new captions**; **Keep edits** discards the candidate. Cancellation/errors also preserve the draft. **Cancel** closes without importing. **Import** adds ordinary editable Caption items to an existing unlocked subtitle track, or creates one if needed, in one undoable EditorCommand. Existing caption collisions block import with a clear error rather than silently hiding/replacing captions.

Clean, Bold and Minimal presets remain editable. Caption font, size, text color and active-word color are adjustable. Select a phrase in the text or toggle words in the disclosure to apply bold, italic, font, color or background emphasis. Emphasis is stored on individual Caption words, independently of the active-word marker. Review and imported playback use the same CaptionWords renderer, with exclusive end boundaries and one active word at a time.

The native text, aligned native word text/timestamps, raw ASR response, model revision, source audio hash, originating audio plan, review edits and chosen output format are saved in `ProjectState.captionTranscripts` and serialized in `.aiditor` files. Original model word objects remain in the raw response. Caption word timing is taken directly from the ASR response; script switching changes only word text. Missing/invalid/out-of-order times or transcript content without timed words block import instead of generating estimated timing. Automatic grouping targets 2–4 words/about three seconds per cue, preferring pauses and punctuation and carrying connected English/Hindi phrases together. A stranded fifth word is rebalanced to 3 + 2. Native equal-time anchors can require a larger group because a usable cue boundary cannot be invented between simultaneous words.

Shruti/Needle permits `start == end` for individual words. These are valid time-point alignments, not missing timestamps. Review, import and project-file validation preserve them unchanged. Point-only cue groups join the nearest adjacent cue only within the same speech run. An isolated point group gets a brief 100 ms **display container**, capped at the next cue and audio end; its native word timestamps remain unchanged. It never extends to a distant utterance. A whole transcript with only one identical time point still cannot produce a timed caption and reports that condition explicitly. [Upstream timestamp contract/test](https://github.com/cactus-compute/needle/blob/cc5953b0292e0a2cb7798361bd339869c71afdfb/tests/test_whistle.py).

Pauses of at least 250 ms between returned word boundaries split cues, including pauses without punctuation. Each cue ends at its last returned word end, capped at the following cue's start if model alignments overlap. No caption is stretched to the next utterance. Review and import use the same container bounds. Auto-caption import preserves exact cue durations instead of applying the subtitle-file importer's 100 ms minimum. Ordinary spacing between words inside a phrase is retained within its caption. Existing imported captions are not automatically rewritten.

## Project audio

### Review layout and words per caption

The review uses 85% of the viewport width (maximum 1760 px), with a larger preview on the left and a single scrolling caption editing pane on the right. Styling is collapsed by default and the bottom action bar stays outside scrolling content. Below 900 px the layout stacks, with one body scroll and a shorter preview so caption editing remains accessible.

**Words per Caption** is available in setup and review: Auto, 1, 2, 3, 4 or 5. Auto targets two words in portrait projects (aspect ratio below 0.85), allowing a short third word or phrase completion for readability. Square/near-square projects target three; landscape projects (ratio at least 1.2) retain the existing phrase grouping. Manual choices override aspect ratio, with soft boundaries that keep function-word pairs and connected phrases together. Pauses, sentence endings and equal-time word anchors still take precedence over counts.

Changing pacing regroups the edited draft locally, preserving retained/inserted words, manual corrections, emphasis and exact word timestamps; it does not transcribe again. The pacing choice is archived with the transcript, and regrouping participates in existing review undo/redo. The native transcript, audio preparation, recognition, playback clock and timeline import architecture are unchanged by this presentation setting. Existing explicit silence gaps in the reviewed captions are preserved.

This refinement passed the full 593-test frontend suite and production build. Regression tests cover portrait/landscape/square defaults, all five manual overrides, function-word and modifier phrases, short triples, silence boundaries, regrouping with edits/insertions/deletions/styles retained, persistence validation and undo/redo. Browser checks used mocked recognition at 1920×1080 and 800×720 to verify desktop columns, the stacked responsive layout, collapsed styling, visible actions and live manual override. Temporary fixtures were removed; no transcription backend or import command was changed.

`projectAudioPlan` derives an analysis mix from the active `ProjectState`, using the same audio-track selection as preview. Muted tracks/items and zero-volume clips are excluded. Linked video streams are not mixed a second time. The plan includes source trims, timeline offsets/gaps, speed, reverse, and evaluated volume/gain automation (sampled at 30 Hz for animated clips). Spatial panning is collapsed into the mono analysis signal.

The Python worker reuses PyAV's existing cached mono 16 kHz source extraction. It mixes the plan in generated app-data cache, preserving timeline silence and offsets. Forward speed uses PyAV/FFmpeg `atempo` to retain pitch; reverse follows the existing reversed-playback rate behavior. Source media is read-only. No finished video is generated or substituted for an editable timeline.

Source extraction respects decoded presentation timestamps, inserting zero PCM samples for gaps between packets and trimming overlapping/negative samples relative to the container start time. Previously, appending decoded frames could collapse sparse audio: a six-second synthetic source with one second of sound, four seconds of silence and another second of sound became a two-second WAV. The `pcm-timeline-v2` cache key invalidates those earlier preparations automatically; the derived project mix is also invalidated whenever its prepared source hash changes.

Quick-mode auto-caption jobs additionally run the **already installed** faster-whisper/Silero VAD on the prepared project mix (local ONNX asset, telemetry disabled; no Whisper ASR model is loaded). It finds speech intervals separated by at least 600 ms, retains 80 ms of edge context, and bounds sections to 28 seconds. Each section is passed separately to Shruti. The section's original sample offset is added to every returned local word start/end, including zero-duration words. Sections are never concatenated into a shorter audio clock. The result's `rawResponse.chunks` retains each unmodified native response and source interval; the combined native text joins section transcripts without translation, rewriting or rescaling word durations. Metadata records the segmentation mode and section count. Speech Lab's standalone Shruti call retains its previous whole-file behavior. VAD and ASR boundaries can still be imperfect; this prevents losing the timeline offset across detected pauses rather than claiming sample-perfect linguistic alignment.

The review captures the audio plan used for transcription. `ImportAutoCaptionsCommand` compares it with the current project before importing; a different project, changed audio plan, duplicate transcript or ID collision is rejected. Import does not depend on playhead position. Undo/redo includes the native transcript metadata and all generated Caption items. Old project files remain valid because transcript metadata is optional.

## Runtime and development restrictions

Speech Lab's UI and general RPCs remain development-only. The editor uses narrowly scoped `auto_captions_start`/`auto_captions_cancel` commands which permit only Shruti status, Shruti installation and project-audio caption generation. Both workflows use the same serialized job broker, registry, NDJSON events, Python worker, cache and process-tree cancellation.

Only Python worker source, the pinned asset manifest, setup script and requirements text are packaged as application resources. Python, installed packages, model weights and native Needle binaries are not bundled. Runtime discovery supports `AIDITOR_SPEECH_PYTHON`, the development `.speech-lab-venv`, and an external runtime in the app-local cache.

For development, use the existing setup and restart the native development app after the new Rust commands:

```powershell
powershell -File scripts/setup-speech-lab.ps1
npm run tauri dev
```

For an installed Windows build without a speech runtime, the dialog reports the packaged setup-script path. Run that script with **`-AppData`**. It installs the pinned runtime into `%LOCALAPPDATA%\com.aiditor.app\speech-lab\runtime`; model installation still uses the existing `models\shruti` directory. Generated project-audio WAVs stay under the existing `speech-lab\audio` cache. A compatible externally managed environment may instead be selected with `AIDITOR_SPEECH_PYTHON`.

## Main implementation files

- `src/components/editor/MenuBar.tsx`, `titlebar/TitleBar.tsx`, `editor/EditorShell.tsx`: File action and modal lifecycle.
- `src/components/captions/AutoCaptionsDialog.tsx`, `TranscriptReview.tsx`, `TranscriptViews.tsx`: setup, shared native transcript controls and editable timed review.
- `src/core/captions/*`: format, phrase grouping, typed immutable draft edits/history, preview projection, shared Roman converter, audio plan and persisted transcript validation. Draft transcript editing is separate from timeline editing; Import is the only command that creates timeline items, and preview seeking uses SetPlayheadCommand.
- `src/core/commands/importAutoCaptionsCommand.ts`: typed deterministic import through the existing subtitle/Caption creation path.
- Project state/schema/serializer: optional native transcript persistence and validation.
- `src/services/speechWorker.ts`, `autoCaptions.ts`: shared serialized protocol and caption client. Speech Lab re-exports the shared broker/converter for compatibility.
- `speech-lab/backend/audio.py`, `project_audio.py`, `caption_audio.py`, `worker.py`, `shruti_transcription.py`: timestamp-preserving source preparation, cached project mix and speech sections anchored to the original timeline through the existing Shruti adapter.
- `src-tauri/src/speech_lab.rs`, `lib.rs`, `tauri.conf.json`, setup script: scoped native commands, runtime/resource discovery and external runtime setup.

## Validation

The final frontend suite passed **582 tests across 62 files**, the Python suite passed **34 tests**, and the production TypeScript/Vite build passed. The unchanged native command layer previously passed its Rust allowlist/process-tree cancellation tests and `cargo check`. Review regressions cover phrase-aware segmentation, missing-word insertion with unchanged-word timing preservation, independent script edits, adding/deleting/splitting/merging, caption and word timing bounds, undo/redo and explicit retry replacement, emphasis/style import into an existing subtitle track, preview/import parity, project save/reopen, malformed stored review rejection, existing-caption collision checks and keyword forwarding.

Audio tests use only temporary synthetic PCM/tone fixtures to verify trims, gaps, overlap, volume, reverse, cache invalidation, 44.1 kHz stereo-to-16 kHz resampling offsets and pitch-preserving speed changes. Transcription and bridge tests use mocked responses. **No real recording was transcribed and no ASR benchmark/comparison was run.** An isolated synthetic browser project verified setup, script switching, inline insertion, split/merge, emphasis, timestamp edits, undo, safe Retry, caption playback, empty preview through a speech gap, adding at the playhead, and successful import through the actual command. The temporary fixture files/tab were removed after verification. The review screenshot is saved outside the repository as a test artifact.

No forced-alignment dependency was added. The observed synchronization issues were source-clock gaps, unconstrained whole-recording timing and the preview's 250 ms media-drift allowance. These are addressed without adding a recognition engine. Shruti's own word alignment can still be imperfect; selected-word timing controls support corrections while retaining the original model response. A separate aligner would need evidence of remaining native alignment error and evaluation against the lightweight/offline constraints before being justified.

The long-recording validation fix adds 4- and 6-minute mocked transcripts containing point-aligned words, checks that every word and exact timestamp survives import, and tests point-only group merging, persistence and the no-interval error. Missing, nonfinite, negative, reversed and unordered times remain invalid. No ASR settings or model weights were changed for this fix.

Pause regressions additionally cover 250 ms, 400 ms, 600 ms and 2-second gaps through actual timeline playback selection, isolated point groups around silence, sub-100 ms cue import, overlapping native alignments, and unchanged subtitle-file minimum duration.

Backend clock regressions use sparse synthetic Matroska PCM packets to reproduce and verify the four-second gap through source preparation and project mixing, with an obsolete cache entry present. Mocked VAD/ASR verifies leading/trailing silence, a five-second internal pause, local-to-project word offsets, immutable per-section responses, equal word boundaries, detector/word bounds validation and no ASR call for a silent recording. No real recording or ASR model benchmark was run.

The native worker resources were inspected: only source/config/setup text is included. Production assets contain the requested caption feature but not the development Speech Lab model manager or benchmarking UI.

References for the audio filter API: [PyAV filters](https://pyav.basswood.io/docs/stable/api/filter.html), [FFmpeg atempo](https://ffmpeg.org/ffmpeg-filters.html#atempo). Shruti pins, API and cache details remain in [the Shruti integration notes](speech-lab-shruti.md).

## Classic and Dynamic caption styles

Caption styling now uses the same grouped picker in transcript review and the
caption inspector. Classic contains Clean, Minimal, Bold, Meme and Highlight.
These styles keep their appearance constant throughout the cue. Dynamic starts
with three reference-inspired styles:

- Script Focus: white sans-serif text with one larger white script word.
- Yellow Focus: handwritten white text with one large, uppercase yellow word.
- Green Pill: a rounded green background, with darker text advancing through
  the phrase using the original word timestamps.

Script Focus and Yellow Focus use fixed emphasis, not the speaking word. Each
caption starts with one deterministic content-word choice, editable with the
Emphasis word buttons in review or the word pills in the caption inspector.
The chosen word remains emphasized for the entire cue. This selection never
changes ASR text, word timings or Roman Hindi conversion. Manual per-word
formatting remains available and overrides preset formatting.

Styles, presentation mode and fixed-word markers are persisted in Caption
properties and the review archive. Timeline preset and typography changes apply to every explicitly selected
caption through one ApplyCaptionStyleCommand (one undo step). The inspector
shows the selection count and mixed preset state. Apply to all captions copies
the primary caption’s preset and custom style across the project, excluding
locked tracks. Text, word timestamps and each caption’s emphasis word remain
independent. The single-caption ApplyCaptionPresetCommand remains available to
existing clients; selecting a focus word still uses UpdateCaptionCommand.
Review supports undo/redo and imports through the existing command path. Both
review video and timeline preview use CaptionWords for identical presentation.
Old projects without presentation metadata retain their previous timed yellow
highlight behavior. New preset application resets incompatible background and
shadow features, so switching away from Green Pill does not retain its box.

Fonts use local desktop font stacks (including Segoe Script and Segoe Print on
Windows) with fallbacks; there are no new font downloads or runtime services.
SRT/VTT remain plain subtitle formats; the editable project retains the styles.

## Editable appearance and behavior

Presets populate editable fields; they do not restrict customization. Start from
scratch creates a plain Custom style. Both review and inspector offer independent
word appearance (all at once, progressive reveal, single word), timed highlighting
(off, current word, spoken words), highlight text/box/underline, fixed emphasis,
and emphasis font/weight/italic/uppercase/color/size/width/spacing. Normal typography,
background fill/opacity/radius/padding/border, outline and shadow remain editable.
In review these are under Caption styling; in the inspector typography/background
remain in their existing sections and behavior/emphasis live under Word Animation.
Selected-caption edits and Apply to all captions preserve these custom values.

Dynamic presets now default to progressive reveal. Older saved caption styles
retain their explicit configuration; reapply a preset or change Word appearance
to adopt the new reveal behavior. Hidden future words reserve their layout space
to avoid moving the phrase/background while speaking. Single-word mode hides the
previous word at its actual end and leaves genuine pauses empty. All word spans
are nonbreaking, including numbers such as 2026. Yellow Focus uses expanded glyphs
and additional tracking; Emphasis width is adjustable. Reveal and highlight are
always derived from the project playhead, with no independent timers.
