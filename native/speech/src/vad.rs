//! Small, shared preprocessing asset. Recognition audio is never cut or compacted.
use crate::{Cancel, Emit, check_cancel};
use anyhow::{Context, Result, bail};
use std::{ffi::CString, path::Path};
use whisper_rs::whisper_rs_sys as ffi;
pub fn install(root: &Path, emit: &Emit, cancel: &Cancel) -> Result<()> {
    crate::models::download(
        &root.join("models/preprocessing/silero-v5.1.2.bin"),
        "https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v5.1.2.bin",
        885098,
        "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf",
        emit,
        cancel,
    )
}
pub fn speech(
    root: &Path,
    samples: &[f32],
    threads: usize,
    cancel: &Cancel,
) -> Result<Vec<(usize, usize)>> {
    check_cancel(cancel)?;
    let path = root.join("models/preprocessing/silero-v5.1.2.bin");
    if !crate::models::verified(
        &path,
        885098,
        "29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf",
    ) {
        bail!(
            "Native speech-boundary asset missing; run aiditor models install tara --engine ctranslate2"
        );
    }
    struct ContextGuard(*mut ffi::whisper_vad_context);
    impl Drop for ContextGuard {
        fn drop(&mut self) {
            unsafe {
                ffi::whisper_vad_free(self.0);
            }
        }
    }
    struct SegmentGuard(*mut ffi::whisper_vad_segments);
    impl Drop for SegmentGuard {
        fn drop(&mut self) {
            unsafe {
                ffi::whisper_vad_free_segments(self.0);
            }
        }
    }
    let name = CString::new(path.to_str().context("Invalid VAD path")?)?;
    unsafe {
        let mut params = ffi::whisper_vad_default_context_params();
        params.n_threads = threads.clamp(1, 4) as i32;
        params.use_gpu = false;
        let ctx = ContextGuard(ffi::whisper_vad_init_from_file_with_params(
            name.as_ptr(),
            params,
        ));
        if ctx.0.is_null() {
            bail!("Cannot load native speech detector");
        }
        let mut params = ffi::whisper_vad_default_params();
        params.threshold = 0.5;
        params.min_silence_duration_ms = 150;
        params.min_speech_duration_ms = 0;
        params.speech_pad_ms = 0;
        let segments = SegmentGuard(ffi::whisper_vad_segments_from_samples(
            ctx.0,
            params,
            samples.as_ptr(),
            i32::try_from(samples.len())?,
        ));
        if segments.0.is_null() {
            bail!("Native speech detection failed");
        }
        let mut speech = vec![];
        for i in 0..ffi::whisper_vad_segments_n_segments(segments.0) {
            // whisper.cpp VAD segment API uses centiseconds.
            let start = (ffi::whisper_vad_segments_get_segment_t0(segments.0, i) as f64 * 160.)
                .round() as usize;
            let end = (ffi::whisper_vad_segments_get_segment_t1(segments.0, i) as f64 * 160.)
                .round() as usize;
            let (start, end) = (start.min(samples.len()), end.min(samples.len()));
            if end > start {
                speech.push((start, end));
            }
        }
        check_cancel(cancel)?;
        Ok(speech)
    }
}
