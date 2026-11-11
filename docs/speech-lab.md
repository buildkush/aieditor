# Native Speech Lab

Development entry: Ctrl+Shift+L or #/speech-lab. It uses the same Rust caption library and cache as Studio and the CLI.

Only Shruti Native and Tara Native (Q8_0/Q5_0) are available. Select models and run them sequentially on the same immutable prepared audio. Progress includes provisional native words. Compare original text, timestamps, processing/inference time, reported backend and optional WER. Roman Hindi remains a separate editable view; TXT/JSON/benchmark CSV exports preserve native results. Recognition does not edit ProjectState.

The original source/sidebar/workspace layout is retained. Each recording keeps
one latest result per model. Retrying replaces that model's previous result;
model failures are shown individually and do not block the remaining models.
The live elapsed clock includes failed work and all selected model runs. Running
both Tara quantizations performs recognition twice.

Device choices are auto, CPU, CUDA and Vulkan. Native Shruti uses CPU. Tara uses DTW alignment with Flash Attention disabled. No tested GPU packs are published yet, so the current installer falls back to CPU. Unsupported VAD, keyword, old chunking, Whistle reconciliation and separate alignment controls were removed.

Run setup.cmd for native build dependencies, FFmpeg and models. See [native captions](native-captions.md) for installation, CLI/MCP, model conversion, benchmarks and validation limits.

Remove previous installations with scripts/cleanup-legacy-speech.ps1. Use -WhatIf to preview. Native model files, imported media, recordings and project files are preserved.
