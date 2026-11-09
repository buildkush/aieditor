# Original Whistle English assistant (Speech Lab only)

**Current Both-mode workflow:** see [Language-span experiment](speech-lab-language-spans.md). Both now preserves full-audio Shruti and sends only classified English phrase crops to Whistle. The full-file comparison details below document the earlier experiment and standalone result helpers.

## Use

Open the desktop development app, then Speech Lab (Ctrl+Shift+L). Whistle has already been downloaded and load-verified in this workspace's app-data cache; no inference or benchmark was run. On another installation, use the existing `scripts/setup-speech-lab.ps1` runtime setup, then click **Download** beside **Whistle (English)**. Shruti and Whistle each have their own installation status and Verify / repair action.

Choose **Both (Experimental) · Shruti + Whistle**, select a recording and optionally enter shared keyword hints. Both weights must be installed. Click **Transcribe**. Shruti uses automatic language detection; Whistle explicitly uses English. They run sequentially in separate worker processes with the same cached mono 16 kHz audio and verified matching audio hash. Cancellation uses the existing process-tree termination and serialized job broker. Completed results survive cancellation or failure of the next engine.

The compare view shows both original transcripts, their available word times, and per-worker processing/memory measurements. Individual runs remain selectable. Keyword biasing is a hint, not an instruction to rewrite the transcript.

Click **Suggest English Corrections** after both results exist for the same prepared audio. Suggestions show original → proposed text, the original timed span and an audio-seek control. They never modify the native results, Roman Hindi, project state or production captions. There is deliberately no automatic acceptance or merge into production.

## Verified upstream assets and API

- Official weights: [Cactus-Compute/whistle](https://huggingface.co/Cactus-Compute/whistle/tree/741118687e1f008f06d1351a402a731274789790), revision `741118687e1f008f06d1351a402a731274789790`.
- `whistle.cact`: 16,919,407 bytes, SHA-256 `b6e02f048568ac5d01a2042556c658061e699acbc0aa2a1439f52f3d461dffeb`. This is the original multilingual Whistle checkpoint used with English configuration, not Shruti or a fine-tune.
- Apache-2.0; the pinned upstream LICENSE is downloaded/checksummed alongside the weights. Exact hashes live in `speech-lab/backend/whistle-assets.json`.
- Existing `cactus-needle==3.2.9` Python package and verified Needle engine 3.3.3 are reused. No new Python dependencies or recognition models are installed. Existing Shruti engine binaries are reused when valid; otherwise a shared engine cache is installed from the existing pinned engine manifest. Removing Shruti cannot leave Whistle falsely marked ready: missing shared binaries require Verify / repair.
- Official [API documentation](https://github.com/cactus-compute/needle/blob/main/llms.txt): explicit `Whistle(local_weights)` and `model.transcribe(prepared_wav, language='en', keywords=hints_or_none, word_timestamps=True)`. Raw responses and optional timestamps normalize through the existing Shruti response schema; no subtitle segments or word times are invented. Missing timestamps remain unavailable.
- Weights are under the existing `speech-lab/models/whistle` app-local cache. Only the small pinned manifest and worker source are packaged. Offline loading sets explicit local weights/library paths and telemetry/offline flags; inference never downloads missing assets.

## Dual-ASR experiment review

The explicit selections are **Shruti only**, **Whistle only (English)** and **Both (Experimental)**. Legacy Whisper Lab options remain available. Both uses a sequential experiment coordinator with model-specific language configuration and matching prepared audio path/hash checks. It records completed results before starting the next engine, so cancellation or errors preserve finished runs. The comparison/review is tied to the exact pair of run IDs, rather than accidentally comparing the newest result with an older alternative.

After Both finishes, the compare view puts Shruti first and Whistle second with independent raw text, metrics and word timing. The **Word-level differences** table aligns overlapping returned intervals into sections. It distinguishes agreement, different wording/brand spelling, possible omissions, unverified extra words, unavailable alignment and unreliable English hypotheses over Hindi. Multiword or weakly overlapping sections are not asserted to be exact word-for-word matches. Untimed words remain untimed; unordered times block alignment.

**Suggest English Corrections** creates an editable table: original text, suggested replacement, source and decision. Edit a proposal, then **Accept** or **Reject** it individually. Acceptance changes only the separate experimental reviewed text. Editing an accepted proposal resets it to pending until explicitly accepted again. Raw Shruti/Whistle text, words, timing, Roman Hindi output and project state remain unchanged. Ambiguous text-to-word correspondence blocks acceptance rather than guessing offsets. Keyword phrases and nearby time-aligned word agreement help rank otherwise qualifying candidates; punctuation-bearing brand hints are retained.

Each model result supports JSON and SRT. The experiment panel additionally exports **comparison JSON**, **comparison SRT**, **Shruti SRT**, **Whistle SRT** and **reviewed SRT**. JSON preserves both complete original results, differences, decisions and reviewed text. Individual SRT cues use actual returned word boundaries and native punctuation; accepted multiword replacements remain one original timed Shruti span, with no invented per-replacement-word times. Point-aligned words can join an adjacent real interval within ordinary word spacing, without altering their archived times or bridging silence. Missing/isolated point timings block SRT with a JSON alternative. Comparison SRT labels the two hypotheses in each genuinely timed section; it is an inspection artifact, not a production merge.

The review and exports exist only in Speech Lab. No production transcription, ProjectState, timeline command, caption import or Roman Hindi converter changes are part of this extension. No recording was processed or benchmarked during implementation.

### Validation of the extension

Final checks passed: 615 frontend tests, 38 Python tests, the TypeScript/Vite production build and Rust `cargo check`. All new inference/orchestration fixtures are mocked; no real recordings or benchmarks were run.

Mocked tests cover sequential configuration/hints, identical prepared source checks, cancellation before the next engine, partial-result retention, errors, timestamp differences/omissions/unreliable sections, correction editing/acceptance/rejection, raw-data preservation and JSON/SRT exports including phrase spans and adjacent point anchors. The existing installation/offline-loading/worker tests remain in place. Run `npm test`, `npm run build`, `.speech-lab-venv/Scripts/python.exe -m unittest discover -s speech-lab/tests -q` and `cargo check --manifest-path src-tauri/Cargo.toml`.

## Candidate matching policy

This is a limited hypothesis-comparison experiment, not an English spell checker or an accuracy guarantee. It examines one-to-three-word spans with monotonically ordered, positive-duration real timestamps. Source hashes must match. Candidate spans need strong temporal overlap, close start/end boundaries and lexical/phonetic similarity. Multiword user keywords are preferred over fragment suggestions, including a word-boundary correction such as `champion sedition` → `Champions Edition`.

Candidate vocabulary is deliberately limited to a small English/product lexicon plus optional user keywords. Devanagari source spans and protected Roman Hindi/English function words are excluded. Unknown English vocabulary, zero-duration/missing times, weak similarity, competing similar-scoring hypotheses and crossing alignments are left unchanged. Whistle can misrecognize Hindi as English; its result is never treated as ground truth. Suggested spans retain Shruti's returned start/end times and source indices. Wider coverage would require evaluating additional vocabulary and alignment evidence, not silently trusting English-only ASR.

## Validation and isolation

604 frontend tests and 38 backend tests passed; production build passed. New fixtures cover checksum installation/corruption, failed loading and repair, offline constructor configuration, English API parameters, normalization, worker routing, model-specific cancellation, separate comparison output/metrics and reconciliation ambiguity/missing/Hindi/mismatched-audio cases. Automated transcription tests use mocks only. Actual checkpoint download, verified engine initialization and cached initialization with socket connections blocked succeeded; no recording was transcribed and no benchmark was performed.

Production Auto Captions still calls only the Shruti adapter. Its native command allowlist still allows downloading only Shruti. No ProjectState, Caption architecture or Roman Hindi converter changes are part of this experiment. The existing Whisper Lab options remain available.
