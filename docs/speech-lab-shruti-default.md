# Single Shruti configuration

Shruti now uses `cactus-needle==3.2.10` under the existing canonical model ID `shruti`, in Audio Lab and production auto captions. Its `shruti.cact` checkpoint, native Needle engine 3.3.3, automatic language detection, keyword handling, timestamp normalization and caption silence processing are unchanged. This consolidates the Python package version; it does not introduce a different native engine.

Audio Lab defaults to Shruti selected. The three available models are Shruti, Shunya INT8 and Whistle. The existing cards support selecting any one, two or three models. The separate Needle 3.2.10 experiment and FP32 experiment are no longer registered, installable or runnable. Legacy benchmark IDs remain readable in previously exported results.

The main speech environment and both setup requirement files pin 3.2.10. There is no JAX/Flax/Orbax dependency in the canonical environment. Experimental weights/environments can be removed using `scripts/remove-retired-shruti-profiles.ps1`. It preserves `models/shruti`, which is the canonical checkpoint and engine cache, and preserves Shunya, Whistle and user recordings and reports.

No real audio inference or benchmarks were run during consolidation.
