# Optional native CTranslate2 CPU runtime

Pinned CTranslate2 4.8.4, commit `5de572ef60b67a0276c5989ee73d0072808ff4c3`.
The C ABI exports model creation/destruction and bounded chunk inference. Python,
Torch, NumPy and Python development headers are not used. Build tools and MKL
headers belong on release builders only; end users consume a verified runtime pack.

The bridge preserves Tara token 51866, its five-token prompt, 128 mel bins,
INT8/FP32 computation, greedy decoding, full 448-position context and attention/DTW
alignment. Cancellation is checked between decoder steps. Encoder/DTW native calls
finish their current operation before observing cancellation.

`patch-ct2.cmake` applies the previous mixed-code/context fixes and adds the abort
callback to the pinned source. An unsupported source revision must not be substituted.
CPU instruction dispatch remains enabled; no development machine ISA is hardcoded.

Upstream licenses must accompany release packs. CTranslate2 is MIT licensed; Intel
MKL/OpenMP use their respective redistributable licenses. The Windows dependency
archives are pinned build inputs containing native DLLs, import libraries and headers;
they are extracted as ZIP files without executing pip or Python.

This runtime requires CT2-format Tara weights. GGML weights cannot be loaded by CT2.
The native converter reads the original pinned checkpoint without modifying it and
uses the same float16 intermediate/per-row INT8 rounding as the previous converter.
Numerical and transcription parity still require benchmark verification.
