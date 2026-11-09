# Experimental Shunya and Srota providers

Open Speech Lab (Ctrl+Shift+L), click **Install runtime** for the desired model, then **Download**. These are independent explicit actions. No weights are fetched by startup, runtime installation, selection, or inference. Choose one or two models using First model / Second model and click Run. Choose None for a single run. Previous runs remain available for comparison; Copy transcript copies the native recognition. Roman Hindi remains a separate optional downstream view.

## Verified artifacts

| Provider | Pinned revision | Actual downloaded assets | License declared by author |
| --- | --- | --- | --- |
| [Shunya Zero STT Hinglish](https://huggingface.co/shunyalabs/zero-stt-hinglish) | `93b882ac4f1d470d910ef8e1e48d44d51a439cc6` | 1,533,469,266 bytes | OpenRAIL |
| [Srota](https://huggingface.co/moorlee/qwen3-asr-0.6b-hinglish) | `188ae2b61f932feb998e3b3c7a868e927a467031` | 1,580,844,716 bytes | Apache-2.0 |

Totals include inference configuration/tokenizer files and the author's README, exclude demo recordings, images, predictions and training state. Every downloaded asset has a pinned SHA-256 and byte size in `experimental-assets.json`. The existing resumable installer verifies corruption and reuses valid files. Remove deletes weights through the existing managed-cache operation. Model weights and optional environments are outside the installer under `%LOCALAPPDATA%\com.aiditor.app\speech-lab\models\{model}` and `runtimes\{model}`. No model license is changed by this integration; consult the retained author cards for terms.

## Runtime and capabilities

Shunya uses the author's recommended Transformers Whisper pipeline, loading the actual linked repository (the card's code snippet contains a stale alternative repository name). It uses Transformers 4.57.6, PyTorch 2.10.0 and Accelerate 1.12.0 in its own environment. The checkpoint supplies native Whisper alignment heads, so optional word timestamps retain returned words and missing endpoints. Transcript comparison defaults to timestamps off and SDPA attention; enable the Shunya word timestamps checkbox to use eager attention and native alignment. These are decoder alignment estimates, not forced alignment from another model. Native transcript and words are preserved without invented subtitle segments. Long audio uses the pipeline's 30-second windows with five-second stride context.

Srota uses the author's pinned `qwen-asr==0.0.6` API, backed by Transformers, in a separate environment. It uses `language=None` as required by this fine-tune. Calls receive at most 30 seconds of unfiltered prepared audio, with boundaries selected near low-energy pauses in the last five seconds of each window. Every sample is retained exactly once. Text from all calls is retained in order. Chunk boundaries are not claimed as speech timestamps. No forced aligner is loaded: Srota has no word/segment times in this integration. Long recordings can have phrase breaks at chunk boundaries; manual recognition testing is still needed.

Both reuse the existing mono 16 kHz PCM preparation and source identity. No denoising, gain adjustment, VAD filtering, script conversion, translation, or vocabulary rewriting is performed by these adapters. Recognition uses local cache paths with offline loading and remote-code execution disabled where supported. Native Hindi/English script is retained exactly as returned.

CPU inference uses float32 and can be slow and memory intensive; roughly 3 GB for weights alone plus activations and runtime overhead. CUDA is selected when available in the optional PyTorch environment; Shunya uses FP16, Srota BF16 when supported (otherwise FP16). Srota uses its supported SDPA attention path, without a FlashAttention dependency. A CUDA-enabled PyTorch build and compatible drivers are needed for GPU execution; the existing CTranslate2 GPU probe does not establish PyTorch CUDA support. An explicitly requested but unavailable CUDA device falls back to CPU with a visible message. Execution errors are reported without silently rerunning a large job.

Runtime packages are downloaded only through Install runtime, independently of model weights. Upstream qwen-asr includes language/audio package dependencies; Windows wheel availability or build requirements may prevent installation on some Python configurations. A failed installation never marks the runtime ready. Repair runtime retries installation; errors appear in Speech Lab. No dependencies are added to Shruti's environment. Environments and native models are released when the owned worker tree exits; Cancel terminates the tree, including installation or inference children.

## Changes and validation

Windows CPU compatibility: the installed PyTorch 2.10 oneDNN/MKLDNN path produced a native access violation (`0xC0000005`) during a synthetic Whisper forward pass. Shunya now disables that backend in its isolated Windows CPU worker and caps CPU threads at four. A synthetic-silence smoke check with an eight-token test-only generation limit completed with the workaround and returned through the word-timestamp pipeline. No real recording was processed. GPU settings and other providers are unaffected. Audio-window progress and decoding activity are reported without altering generation limits in production; missing native results now report the process exit status.

Provider modules: `shunya_adapter.py`, `srota_adapter.py`, `experimental_runtime.py`, `experimental_inference.py`, `experimental-assets.json`. Existing model registry/downloader, worker routing, bundled metadata, Speech Lab selectors/status/actions, transcript helpers and result types were extended. Production Auto Captions, Shruti recognition, ProjectState and timeline commands are unchanged.

Automated validation uses synthetic arrays and mocked models, covering offline manifests, missing/failed runtimes, child error forwarding, long-audio chunking, author decoding options, native text/timestamp preservation, cleanup and comparison UI. Existing installer and worker cancellation tests remain in place. No real recordings or benchmarks were run automatically. Subsequent troubleshooting verified local Srota loading and a bounded Shunya synthetic-silence call; these checks do not establish recognition completeness on real recordings.

Primary runtime documentation: [Qwen3-ASR](https://github.com/QwenLM/Qwen3-ASR), [Transformers Whisper](https://huggingface.co/docs/transformers/v4.57.1/en/model_doc/whisper).


## Incomplete-transcript investigation

The supplied 83.68475-second CSV records Srota on CPU float32: 129.662978 seconds inference plus 9.423681 seconds model loading. The installed optional PyTorch environments are CPU builds. The exported native text is already shorter than the Shruti hypothesis and omits the final product/promotion section, so this is not solely a scrolled transcript viewer. There is no verified ground-truth transcript, and the old result has no per-chunk text or EOS/token-limit trace; the CSV cannot prove precisely where or why recognition omitted speech.

The previous adapter passed all audio in hard 30-second cuts. The updated adapter selects pause-aware boundaries, retains input ranges and native output per chunk in JSON, displays coverage in the review, and warns when a chunk returns no text. These input ranges are not invented speech timestamps. All chunks are still processed even when one returns empty text; no transcript is borrowed from Shruti or fabricated. The audit proves input coverage, not recognition completeness. Shunya's optional alignment setting and Srota's SDPA path remove avoidable integration overhead; no real-recording speedup or accuracy improvement has been benchmarked. Production captions and Shruti are unaffected.
