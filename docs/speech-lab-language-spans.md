# Language-span dual-ASR experiment

Speech Lab's **Both (Experimental) · Language spans** mode now runs full-audio Shruti first, then processes only confidently classified English phrases with Whistle. **Shruti only** and **Whistle only (English)** retain their existing behavior. Production Auto Captions, ProjectState, timeline commands, caption import, model weights and Roman Hindi conversion are unchanged.

## Manual use

1. Open Speech Lab with Ctrl+Shift+L and install/verify Shruti and Whistle using their existing model cards. No new dependency or model download is needed for an existing installation.
2. Select **Both (Experimental)** and choose a recording. Optional shared keyword hints still go through documented ASR keyword arguments.
3. Under **English language spans**, set crop context (default 0.12 seconds each side, configurable from 0 to 0.5 seconds). Enter global and project/recording vocabulary, one phrase per line. Explicit phonetic aliases use `Harry Potter | हैरी पॉटर`. Global terms persist in localStorage; project terms are scoped to the selected prepared recording in this Lab session, not stored in ProjectState.
4. Click **Transcribe**. Shruti runs once on the full prepared file with automatic language detection. Its complete native result is saved before any English crops run. The same cached mono 16 kHz WAV supplies all crops. Whistle is loaded once for the English batch and called with `language='en'`, timestamps and keywords for each crop.
5. Inspect the language table: original span, language/reason, original timing/confidence, contained Whistle phrase and decision evidence. Expand **Raw crop output and context** for the complete alternative (including any context words), crop bounds, inference duration, global word times and confidences. Context output is evidence only, not a source of Hindi replacements.
6. Click **Suggest English Corrections**. Edit and accept/reject proposals individually. A separate reviewed text preserves Shruti's sentence order and all non-selected words. Export span-experiment JSON for both raw evidence and review decisions, or reviewed SRT where real timing permits it.

## Classification policy

The classifier groups consecutive Hindi, English, uncertain or mixed words, splitting long pauses. It uses common Hindi words in both scripts, an intentionally limited English lexicon, proper-name phrases, known Devanagari loan/name aliases and explicit vocabulary. Multiword names are matched before individual words; near spellings of known Latin proper-name phrases can retain phrase identity. Known Hindi function words cannot be pulled into an English alias by user vocabulary. Mixed-script words remain mixed. Unknown Latin words and unfamiliar Devanagari words remain uncertain rather than being forced into either language. No new language-identification model or LLM is used.

Example: `Bhai Harry Potter ko pachees saal ho gaye` becomes Hindi `Bhai`, English `Harry Potter`, Hindi `ko pachees saal ho gaye`. `Bhai Harry Potter ka wand pen hai` produces two English crops, with `Bhai`, `ka` and `hai` retained from Shruti. Phonetic English names such as `हैरी पॉटर` can be classified through a known alias; agreement with canonical English keeps Shruti's original script, rather than translating it automatically.

Vocabulary is evidence, not an instruction to replace words. Dictionaries are incomplete: review uncertain spans and add explicit proper-name aliases before another experiment. Recognition accuracy is not established by mocked tests.

## Audio and timing

The Lab-only `whistle_spans` worker operation checks the prepared audio hash, finite ordered nonoverlapping English intervals and context bounds before loading Whistle. It reads sample-exact sections into float PCM arrays without concatenating separated spans or rewriting the source. Crop boundaries are rounded outward to sample positions; each native local word time receives the actual crop-start offset exactly once. Original local responses, including confidence and optional/missing times, stay in `rawResponse`. Per-crop failures are recorded, while installation/stale-source failures use the existing job error path. Existing job-scoped NDJSON and process-tree cancellation apply.

Reconciliation compares complete English spans. Words wholly outside an English ownership interval are ignored as context. A small timing drift is allowed only in gaps between spans, capped at 100 ms and neighbouring span bounds; a word entering an adjacent Hindi/uncertain span rejects that hypothesis. Untimed/point-only alternative words, missing raw-text alignment, weak coverage or unordered alternatives lead to retention. Original Shruti indices and span anchors define any accepted replacement; no proposed per-word times are invented.

Phrase agreement retains Shruti. Different phrases need compatible pronunciation/timing plus either a meaningful confidence advantage or sufficiently strong vocabulary evidence without materially weaker confidence. Raw transcripts and native word objects are never altered. Review acceptance only changes the explicitly selected English source span, preserving surrounding Hindi and punctuation. No automatic merge into production exists.

## Validation

Final checks passed: 626 frontend tests, 41 backend tests, the production build and Rust `cargo check`. Production bundle assets remain unchanged because the new workflow is isolated to the development Speech Lab.

Mocked frontend tests cover the example segmentation, known Devanagari names, uncertain/mixed tokens, protected Hindi boundaries, complete name phrases, agreement, better phrase suggestions, acceptance preserving surrounding Hindi, missing/weak/cross-boundary hypotheses, timing drift confined to gaps, English-only routing, cancellation and partial primary-result retention. Synthetic-WAV backend tests verify crop sample ranges/context, offset restoration, raw-response/word-time preservation, source immutability, interval validation and worker routing. No real recording or ASR benchmark was run.

The prior full-file dual-ASR comparison helpers remain for backwards-compatible tests and manual comparison of existing standalone results; the Both UI now uses this span coordinator and does not obtain a whole-file English hypothesis over Hindi audio.
