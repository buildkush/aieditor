# aiditor native speech fork

Source: crates.io `whisper-rs-sys` 0.15.0, upstream crate revision
`7558e1b72f54f2f22a53589afb77e65681834c36`. Upstream licenses remain in this tree.

Local changes:

- Recognize Tara's padded vocabulary of 51904 as 100 language tokens. Preserve
  the standard Whisper token offsets and require mixedcode token 51866.
- Insert Tara's trained mixedcode/task prefix in recognition and DTW alignment.
- With Tara's no-history decoding, use its remaining 448-position context
  instead of stock Whisper's half-context generation cap. Record cap hits so
  truncated output and fallback retries are visible.
- Expose the native DTW path's start/end intervals through token data; fix the
  new-segment callback count after alignment.
- Expose read-only per-state timing and retry counters through the versioned
  aiditor profiling API, separating recognition decoding from alignment replay.
- Refresh the patched source during Cargo rebuilds, support Windows CUDA builds
  without Unix compiler flags and permit pre-generated bindings without Clang.
- Correct the pre-generated bindings' 64-bit integer aliases for Windows LLP64
  and enum signedness expected by whisper-rs. C runtime types are unused by
  aiditor; do not call the generated Linux CRT declarations from Windows.

The base build statically links CPU inference. Optional GPU plugins build this
same fork with a CUDA/Vulkan Cargo feature and use a separate, versioned C ABI.
# GPU offload reporting

`aiditor_whisper_gpu_model_v1` inspects the loaded model buffers. A registered
GPU alone is not accepted as proof that a model was offloaded. Both discrete and
integrated GPU buffer types are supported; CPU-only fallback is reported as CPU.

