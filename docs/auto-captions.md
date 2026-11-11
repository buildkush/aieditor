# Native auto captions

Generate Auto Captions uses Tara by default; Quick mode explicitly selects native Shruti. Both run in process through src-tauri and native/speech. No Python backend or virtual environment is used.

Audio preparation derives a plan from the active ProjectState, preserving track/item mute, gain, trims, gaps, overlaps, forward speed and reverse. FFmpeg decodes immutable media to generated app-data cache.

Returned native word intervals are validated and reviewed. Recognition never edits a project. Import uses ApplyCaptionTrackCommand (the validated, undoable ImportAutoCaptionsCommand) shared by UI and agents. Review, Roman Hindi, pacing, styling, emphasis and caption editing remain supported.

Only tara, tara-q5_0 and shruti model IDs are supported. See [native runtime and setup](native-captions.md) and [Speech Lab](speech-lab.md). GPU pack publishing and GPU performance validation remain outstanding.
