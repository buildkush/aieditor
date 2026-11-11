use crate::{Cancel, Emit, Word, check_cancel, models};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    ffi::{CStr, c_char, c_int, c_void},
    fs,
    path::Path,
    sync::{Mutex, OnceLock, atomic::Ordering},
    time::Instant,
};
use whisper_rs::{
    DtwMode, DtwParameters, FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters,
    whisper_rs_sys as ffi,
};
#[derive(Serialize, Deserialize)]
pub struct Decoded {
    pub text: String,
    pub words: Vec<Word>,
    pub segments: Vec<Value>,
    pub language: Option<String>,
    pub device: String,
    pub compute_type: String,
    pub revision: String,
    pub warnings: Vec<String>,
    pub fallback: Option<String>,
    pub load_sec: f64,
    #[serde(default)]
    pub verification_sec: f64,
    pub inference_sec: f64,
    #[serde(default)]
    pub native_profile: Value,
}
static INFERENCE: OnceLock<Mutex<()>> = OnceLock::new();

// Own callback storage until whisper_full returns. whisper-rs 0.16's safe abort
// helper casts a boxed trait object to the closure's concrete type; do not use
// that helper (or leak callback boxes across repeated jobs).
struct Callbacks {
    emit: Emit,
    abort: Arc<dyn Fn() -> bool + Send + Sync>,
    duration: f64,
    state_address: std::sync::atomic::AtomicUsize,
    gpu_model: std::sync::atomic::AtomicBool,
}
unsafe extern "C" {
    fn aiditor_whisper_gpu_model_v1(context: *const ffi::whisper_context) -> bool;
    #[cfg(test)]
    fn aiditor_whisper_generation_budget_v1(
        vocabulary: i32,
        context: i32,
        prompt_tokens: i32,
        no_history: bool,
    ) -> i32;
    fn aiditor_whisper_profile_v1(
        state: *const ffi::whisper_state,
        out: *mut f64,
        count: usize,
    ) -> bool;
}
fn native_profile(state: usize, threads: i32, aligned: bool, fallback: bool) -> Value {
    if state == 0 {
        return Value::Null;
    }
    let mut data = [0.; 15];
    if !unsafe {
        aiditor_whisper_profile_v1(
            state as *const ffi::whisper_state,
            data.as_mut_ptr(),
            data.len(),
        )
    } {
        return Value::Null;
    }
    json!({"melSec":data[0],"encoderSec":data[1],"generationDecoderSec":data[2],"alignmentDecoderSec":data[3],"alignmentPostprocessSec":data[4],"samplingSec":data[5],"encoderCalls":data[6],"decoderTokenCalls":data[7],"decodeAttempts":data[9],"decodeRetries":data[10],"alignmentCalls":data[11],"logprobFailures":data[12],"entropyFailures":data[13],"tokenLimitHits":data[14],"threads":threads,"alignmentEnabled":aligned,"temperatureFallback":fallback,"flashAttention":false,"systemInfo":whisper_rs::print_system_info()})
}
unsafe extern "C" fn native_abort(user: *mut c_void) -> bool {
    let callbacks = unsafe { &*(user as *const Callbacks) };
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| (callbacks.abort)())).unwrap_or(true)
}
unsafe extern "C" fn native_progress(
    ctx: *mut ffi::whisper_context,
    state: *mut ffi::whisper_state,
    percent: i32,
    user: *mut c_void,
) {
    let percent = percent.clamp(0, 100);
    let callbacks = unsafe { &*(user as *const Callbacks) };
    callbacks.gpu_model.store(
        unsafe { aiditor_whisper_gpu_model_v1(ctx) },
        Ordering::Relaxed,
    );
    callbacks
        .state_address
        .store(state as usize, Ordering::Relaxed);
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        (callbacks.emit)(
            "progress",
            json!({"stage":"transcribing","message":"Native Tara recognition","completed":percent,"total":100}),
        )
    }));
}
unsafe extern "C" fn native_segments(
    ctx: *mut ffi::whisper_context,
    state: *mut ffi::whisper_state,
    count: i32,
    user: *mut c_void,
) {
    let callbacks = unsafe { &*(user as *const Callbacks) };
    callbacks.gpu_model.store(
        unsafe { aiditor_whisper_gpu_model_v1(ctx) },
        Ordering::Relaxed,
    );
    callbacks
        .state_address
        .store(state as usize, Ordering::Relaxed);
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        // Only inspect the state during its callback; never retain FFI pointers.
        let total = unsafe { ffi::whisper_full_n_segments_from_state(state) };
        for segment in (total - count).max(0)..total {
            let text = unsafe { ffi::whisper_full_get_segment_text_from_state(state, segment) };
            if text.is_null() {
                continue;
            }
            let text = unsafe { CStr::from_ptr(text) }
                .to_string_lossy()
                .into_owned();
            let mut tokens = Vec::new();
            for index in 0..unsafe { ffi::whisper_full_n_tokens_from_state(state, segment) } {
                let data =
                    unsafe { ffi::whisper_full_get_token_data_from_state(state, segment, index) };
                if data.id >= 50257 {
                    continue;
                }
                let piece = unsafe { ffi::whisper_token_to_str(ctx, data.id) };
                if piece.is_null() {
                    continue;
                }
                tokens.push((
                    unsafe { CStr::from_ptr(piece) }.to_bytes().to_vec(),
                    data.t0 as f64 / 100.,
                    data.t1 as f64 / 100.,
                    data.p as f64,
                ));
            }
            if let Ok(words) = merge_tokens(tokens, callbacks.duration) {
                (callbacks.emit)(
                    "progress",
                    json!({"stage":"partial","message":"Native words aligned","partialSegment":{"text":text,"words":words,"provisional":true}}),
                );
            }
        }
    }));
}

pub fn transcribe(
    root: &Path,
    model: &str,
    samples: &[f32],
    request: &Value,
    emit: &Emit,
    cancel: &Cancel,
) -> Result<Decoded> {
    // Needle uses process-global native state; all engine jobs share one gate.
    let gate = INFERENCE.get_or_init(|| Mutex::new(()));
    let _guard = loop {
        check_cancel(cancel)?;
        match gate.try_lock() {
            Ok(lock) => break lock,
            Err(std::sync::TryLockError::Poisoned(_)) => {
                bail!("Previous native inference panicked; restart the caption process")
            }
            Err(std::sync::TryLockError::WouldBlock) => {}
        }
        std::thread::sleep(std::time::Duration::from_millis(40));
    };
    let _resource_lease = crate::resources::acquire(root, emit, cancel)?;
    check_cancel(cancel)?;
    if model == "shruti" {
        shruti(root, samples, emit, cancel)
    } else {
        let engine = request["engine"].as_str().unwrap_or("auto");
        if !["auto", "whisper-cpp", "ctranslate2"].contains(&engine) {
            bail!("Unknown native inference engine");
        }
        if engine == "ctranslate2" {
            if model != "tara"
                || !["auto", "cpu"].contains(&request["device"].as_str().unwrap_or("auto"))
            {
                bail!(
                    "The native CT2 CPU pack supports Tara INT8 on CPU; Q5 and GPU requests use whisper.cpp"
                );
            }
            return crate::ct2::transcribe(root, samples, request, emit, cancel);
        }
        if let Some(result) = crate::accelerator::try_gpu(root, samples, request, emit, cancel)? {
            return Ok(result);
        }
        let mut fallback = None;
        if engine == "auto"
            && model == "tara"
            && crate::ct2::pack_ready(root)
            && crate::ct2::model_marker(root, false).is_ok()
        {
            match crate::ct2::transcribe(root, samples, request, emit, cancel) {
                Ok(value) => return Ok(value),
                Err(error) => {
                    check_cancel(cancel)?;
                    if models::tara_marker(&models::tara_path(root), false).is_err() {
                        return Err(error);
                    }
                    let message =
                        format!("Native CT2 unavailable: {error}. Using installed GGML CPU model.");
                    emit("progress", json!({"stage":"fallback","message":message}));
                    fallback = Some(message);
                }
            }
        }
        let mut result = whisper(root, samples, request, emit, cancel)?;
        if let Some(reason) = fallback {
            result.fallback = Some(reason);
        }
        Ok(result)
    }
}
pub fn merge_tokens(tokens: Vec<(Vec<u8>, f64, f64, f64)>, duration: f64) -> Result<Vec<Word>> {
    let mut bytes = Vec::new();
    let mut times = Vec::new();
    for (piece, start, end, confidence) in tokens {
        if !start.is_finite()
            || !end.is_finite()
            || start < 0.
            || end < start
            || end > duration + 0.1
        {
            bail!(
                "Native token timestamps are unavailable or invalid; review alignment before importing"
            )
        }
        times.extend(std::iter::repeat_n((start, end, confidence), piece.len()));
        bytes.extend(piece);
    }
    // Whisper uses byte BPE: one Unicode scalar may span multiple tokens.
    // Decode the whole stream first. A genuinely malformed model output is
    // represented by U+FFFD and review warnings, rather than failing the job or
    // dropping valid words. Keep every decoded scalar tied to its source bytes.
    let mut decoded = Vec::new();
    let mut offset = 0;
    while offset < bytes.len() {
        let remaining = &bytes[offset..];
        let valid = match std::str::from_utf8(remaining) {
            Ok(_) => remaining.len(),
            Err(error) => error.valid_up_to(),
        };
        let text = std::str::from_utf8(&remaining[..valid]).unwrap();
        for (at, character) in text.char_indices() {
            decoded.push((character, offset + at, offset + at + character.len_utf8()));
        }
        offset += valid;
        if offset < bytes.len() {
            let error = std::str::from_utf8(&bytes[offset..]).unwrap_err();
            let count = error.error_len().unwrap_or(bytes.len() - offset);
            decoded.push(('\u{fffd}', offset, offset + count));
            offset += count;
        }
    }
    let mut words = Vec::new();
    let mut text = String::new();
    let (mut start, mut end, mut confidence) = (0., 0_f64, 1_f64);
    for (character, first, last) in decoded {
        if character.is_whitespace() {
            if !text.is_empty() {
                words.push(Word {
                    text: std::mem::take(&mut text),
                    start_time: start,
                    end_time: end,
                    confidence: Some(confidence),
                    timing_needs_review: true,
                });
            }
            continue;
        }
        if text.is_empty() {
            start = times[first].0;
            end = times[first].1;
            confidence = times[first].2;
        }
        for point in &times[first..last] {
            end = end.max(point.1);
            confidence = confidence.min(point.2);
        }
        text.push(character);
    }
    if !text.is_empty() {
        words.push(Word {
            text,
            start_time: start,
            end_time: end,
            confidence: Some(confidence),
            timing_needs_review: true,
        });
    }
    crate::validate_words(&words, duration)?;
    Ok(words)
}

fn whisper(
    root: &Path,
    samples: &[f32],
    request: &Value,
    emit: &Emit,
    cancel: &Cancel,
) -> Result<Decoded> {
    let cancelled = cancel.clone();
    whisper_with_abort(
        root,
        samples,
        request,
        emit,
        Arc::new(move || cancelled.load(Ordering::Relaxed)),
    )
}
use std::sync::Arc;
pub(crate) fn whisper_with_abort(
    root: &Path,
    samples: &[f32],
    request: &Value,
    emit: &Emit,
    abort: Arc<dyn Fn() -> bool + Send + Sync>,
) -> Result<Decoded> {
    let model = if request["model"] == "tara-q5_0" {
        root.join("models/ggml-tara-q5_0.bin")
    } else {
        models::tara_path(root)
    };
    emit(
        "progress",
        json!({"stage":"verifying","message":"Verifying Tara model; unchanged files reuse verification"}),
    );
    let verification = Instant::now();
    let marker = models::tara_marker(&model, true)
        .context("Install native Tara with aiditor models install tara")?;
    let verification_sec = verification.elapsed().as_secs_f64();
    emit(
        "progress",
        json!({"stage":"loading","message":"Loading native Tara model"}),
    );
    let timer = Instant::now();
    let mut context_params = WhisperContextParameters::default();
    let accelerated = cfg!(any(feature = "cuda", feature = "vulkan", feature = "metal"));
    context_params.use_gpu = accelerated && request["device"] != "cpu";
    // Flash attention and cross-attention DTW are incompatible upstream. Accurate
    // word timing takes priority; never silently claim both paths were enabled.
    context_params.flash_attn = false;
    let diagnostics = &request["diagnostics"];
    let aligned = diagnostics["alignment"].as_bool().unwrap_or(true);
    let temperature_fallback = diagnostics["temperatureFallback"].as_bool().unwrap_or(true);
    let threads = diagnostics["threads"]
        .as_i64()
        .unwrap_or_else(|| crate::cpu::inference_threads() as i64);
    if !(1..=64).contains(&threads) {
        bail!("Diagnostic threads must be between 1 and 64")
    }
    let heads: Vec<_> = marker["alignmentHeads"]
        .as_array()
        .context("Missing Tara alignment heads")?
        .iter()
        .map(|p| -> Result<_> {
            let layer = p[0].as_i64().context("Invalid alignment layer")?;
            let head = p[1].as_i64().context("Invalid alignment head")?;
            if !(0..32).contains(&layer) || !(0..20).contains(&head) {
                bail!("Alignment head out of bounds")
            }
            Ok(ffi::whisper_ahead {
                n_text_layer: layer as i32,
                n_head: head as i32,
            })
        })
        .collect::<Result<_>>()?;
    if heads.is_empty() {
        bail!("Missing alignment head configuration")
    }
    context_params.dtw_parameters = DtwParameters {
        mode: if aligned {
            DtwMode::Custom { aheads: &heads }
        } else {
            DtwMode::None
        },
        ..Default::default()
    };
    let context = WhisperContext::new_with_params(
        model.to_str().context("Invalid model path")?,
        context_params,
    )
    .context("Cannot load Tara GGML")?;
    let mut state = context.create_state()?;
    let load_sec = timer.elapsed().as_secs_f64();
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_n_threads(threads as i32);
    if !temperature_fallback {
        params.set_temperature_inc(0.);
    }
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);
    params.set_no_context(true);
    // no_context clears an earlier full() call, but whisper.cpp still carries
    // text between windows unless the rolling prompt budget is also zero.
    // Match Tara's previous condition_on_previous_text=false pipeline.
    params.set_n_max_text_ctx(0);
    params.set_no_timestamps(true);
    params.set_token_timestamps(aligned);
    params.set_split_on_word(true);
    let language = request["language"].as_str().unwrap_or("hi");
    if !["hi", "en", "auto"].contains(&language) {
        bail!("Supported language hints: hi, en, auto")
    }
    params.set_language(if language == "auto" {
        None
    } else {
        Some(language)
    });
    let mut callbacks = Box::new(Callbacks {
        emit: emit.clone(),
        abort: abort.clone(),
        duration: samples.len() as f64 / 16000.,
        state_address: std::sync::atomic::AtomicUsize::new(0),
        gpu_model: std::sync::atomic::AtomicBool::new(false),
    });
    let user = (&mut *callbacks as *mut Callbacks).cast();
    // These callbacks only read live native state and own no borrowed Rust data.
    unsafe {
        params.set_abort_callback(Some(native_abort));
        params.set_abort_callback_user_data(user);
        params.set_progress_callback(Some(native_progress));
        params.set_progress_callback_user_data(user);
        params.set_new_segment_callback(Some(native_segments));
        params.set_new_segment_callback_user_data(user);
    }
    let inference = Instant::now();
    let outcome = state.full(params, samples);
    // The owned WhisperState is still alive after full returns; callbacks only
    // capture its address and this C API reads counters without mutating state.
    let mut native_profile = native_profile(
        callbacks.state_address.load(Ordering::Relaxed),
        threads as i32,
        aligned,
        temperature_fallback,
    );
    let gpu_model = callbacks.gpu_model.load(Ordering::Relaxed);
    native_profile["gpuModelBuffers"] = json!(gpu_model);
    drop(callbacks);
    outcome?;
    if abort() {
        bail!("Cancelled")
    }
    let mut text_bytes = Vec::new();
    let mut tokens = Vec::new();
    let mut segments = Vec::new();
    for segment in state.as_iter() {
        text_bytes.extend_from_slice(segment.to_bytes()?);
        segments.push(json!({"id":segment.segment_index(),"text":segment.to_str_lossy()?,"startTime":segment.start_timestamp()as f64/100.,"endTime":segment.end_timestamp()as f64/100.,"words":[]}));
        for index in 0..segment.n_tokens() {
            let token = segment.get_token(index).unwrap();
            if token.token_id() >= 50257 {
                continue;
            }
            let data = token.token_data();
            tokens.push((
                token.to_bytes()?.to_vec(),
                data.t0 as f64 / 100.,
                data.t1 as f64 / 100.,
                data.p as f64,
            ));
        }
    }
    let text = String::from_utf8_lossy(&text_bytes).into_owned();
    let words = if aligned {
        merge_tokens(tokens, samples.len() as f64 / 16000.)?
    } else {
        vec![]
    };
    let mut warnings=vec!["Word timestamps are model estimates and require review; Q8_0/Q5_0 are lossy, not bit-exact.".to_string(),"Flash attention disabled for DTW word alignment.".to_string()];
    if !aligned {
        warnings =
            vec!["Diagnostic recognition-only run: no word timestamps were computed.".into()];
    }
    if native_profile["tokenLimitHits"].as_f64().unwrap_or(0.) > 0. {
        warnings.push("The decoder reached its token budget; recognition may be incomplete. Review coverage or use shorter speech windows.".into());
    }
    if text.contains('\u{fffd}') || words.iter().any(|word| word.text.contains('\u{fffd}')) {
        warnings.push("The model emitted malformed UTF-8 bytes. Replacement characters (�) are preserved and the affected words require review.".into());
    }
    let fallback = if !accelerated && request["device"] != "cpu" {
        Some(
            "This build has CPU inference only; no compatible acceleration pack is installed."
                .into(),
        )
    } else {
        None
    };
    for segment in &mut segments {
        let start = segment["startTime"].as_f64().unwrap();
        let end = segment["endTime"].as_f64().unwrap();
        segment["words"] = serde_json::to_value(
            words
                .iter()
                .filter(|w| w.start_time >= start && w.start_time < end)
                .collect::<Vec<_>>(),
        )?;
    }
    // A registered GPU is not evidence of offload. Require GPU-resident model buffers.
    let actual_gpu = gpu_model && context_gpu(request);
    Ok(Decoded {
        text,
        words,
        segments,
        language: whisper_rs::get_lang_str(state.full_lang_id_from_state()).map(str::to_owned),
        device: if actual_gpu {
            if cfg!(feature = "cuda") {
                "cuda"
            } else if cfg!(feature = "metal") {
                "metal"
            } else {
                "vulkan"
            }
        } else {
            "cpu"
        }
        .into(),
        compute_type: marker["quantization"].as_str().unwrap_or("unknown").into(),
        revision: "tara-ggml-v1".into(),
        warnings,
        fallback,
        load_sec,
        verification_sec,
        inference_sec: inference.elapsed().as_secs_f64(),
        native_profile,
    })
}
fn context_gpu(request: &Value) -> bool {
    cfg!(any(feature = "cuda", feature = "vulkan", feature = "metal")) && request["device"] != "cpu"
}
fn shruti(root: &Path, samples: &[f32], emit: &Emit, cancel: &Cancel) -> Result<Decoded> {
    if models::status(root, "shruti")?["installed"] != true {
        bail!("Install Shruti with aiditor models install shruti")
    }
    let started = Instant::now();
    let bytes = fs::read(root.join("models/shruti/shruti.cact"))?;
    // Resolve only the checksum-verified, app-owned DLL. Missing libraries return
    // an error from LoadLibrary, instead of terminating the application at launch.
    let library = unsafe {
        libloading::Library::new(root.join("models/shruti").join(models::shruti_library()))
    }?;
    type Load = unsafe extern "C" fn(*const u8, u64) -> c_int;
    type Recognize = unsafe extern "C" fn(
        *const f32,
        c_int,
        *const c_char,
        *const c_char,
        c_int,
        *mut c_char,
        c_int,
    ) -> c_int;
    type Error = unsafe extern "C" fn() -> *const c_char;
    let load: libloading::Symbol<Load> = unsafe { library.get(b"needle_load\0") }?;
    let recognize: libloading::Symbol<Recognize> = unsafe { library.get(b"needle_transcribe\0") }?;
    let last_error: libloading::Symbol<Error> = unsafe { library.get(b"needle_last_error\0") }?;
    let error = || {
        let ptr = unsafe { last_error() };
        if ptr.is_null() {
            "Needle failed".to_string()
        } else {
            unsafe { CStr::from_ptr(ptr) }
                .to_string_lossy()
                .into_owned()
        }
    };
    if unsafe { load(bytes.as_ptr(), bytes.len() as u64) } < 0 {
        bail!("{}", error())
    }
    let load_sec = started.elapsed().as_secs_f64();
    let inference = Instant::now();
    let mut text = String::new();
    let mut words = Vec::new();
    let mut segments = Vec::new();
    let mut language = None;
    // Bound cancellation latency and native output-buffer requirements. Preserve
    // source offsets, including silent sections; never concatenate away pauses.
    for (offset, chunk) in samples.chunks(16000 * 20).enumerate() {
        check_cancel(cancel)?;
        emit(
            "progress",
            json!({"stage":"transcribing","message":"Native Shruti recognition","completed":offset*20*16000,"total":samples.len()}),
        );
        let mut buffer = vec![0u8; 1024 * 1024];
        let code = unsafe {
            recognize(
                chunk.as_ptr(),
                chunk.len().try_into()?,
                std::ptr::null(),
                std::ptr::null(),
                1,
                buffer.as_mut_ptr().cast(),
                buffer.len() as i32,
            )
        };
        if code < 0 {
            bail!("{}", error())
        }
        check_cancel(cancel)?;
        let end = buffer
            .iter()
            .position(|v| *v == 0)
            .context("Unterminated native transcript")?;
        let value: Value = serde_json::from_slice(&buffer[..end])?;
        if let Some(part) = value["text"].as_str() {
            if !text.is_empty() {
                text.push(' ')
            }
            text.push_str(part)
        }
        language = value["language"].as_str().map(str::to_owned).or(language);
        let mut chunk_words = Vec::new();
        for word in value["words"]
            .as_array()
            .context("Native engine did not return word timings")?
        {
            let start = word["start"]
                .as_f64()
                .context("Missing native word start")?;
            let end = word["end"].as_f64().context("Missing native word end")?;
            chunk_words.push(Word {
                text: word["word"]
                    .as_str()
                    .context("Missing native word text")?
                    .into(),
                start_time: start,
                end_time: end,
                confidence: word["probability"].as_f64(),
                timing_needs_review: start < 0.2 || end > chunk.len() as f64 / 16000. - 0.2,
            });
        }
        crate::validate_words(&chunk_words, chunk.len() as f64 / 16000.)?;
        for word in &mut chunk_words {
            word.start_time += offset as f64 * 20.;
            word.end_time += offset as f64 * 20.;
        }
        let segment = json!({"id":offset,"text":value["text"],"startTime":offset as f64*20.,"endTime":offset as f64*20.+chunk.len()as f64/16000.,"words":chunk_words});
        emit(
            "progress",
            json!({"stage":"partial","message":"Native words decoded","partialSegment":segment,"provisional":true}),
        );
        segments.push(segment);
        words.extend(chunk_words);
    }
    Ok(Decoded {
        text,
        words,
        segments,
        language,
        device: "cpu".into(),
        compute_type: "Needle INT4/INT8".into(),
        revision: "ebf52e614065ce20e56affdab641f749a04511a5".into(),
        warnings: vec!["Words near native chunk boundaries require review.".into()],
        fallback: None,
        load_sec,
        verification_sec: 0.,
        inference_sec: inference.elapsed().as_secs_f64(),
        native_profile: Value::Null,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tara_uses_its_available_context_without_changing_stock_whisper_budget() {
        let tara = unsafe { aiditor_whisper_generation_budget_v1(51904, 448, 5, true) };
        assert_eq!(tara, 442);
        assert!(tara + 5 < 448);
        assert_eq!(
            unsafe { aiditor_whisper_generation_budget_v1(51865, 448, 5, true) },
            220
        );
        assert_eq!(
            unsafe { aiditor_whisper_generation_budget_v1(51904, 448, 229, true) },
            218
        );
    }
    #[test]
    fn merges_utf8_byte_tokens_without_replacement() {
        let bytes = " का".as_bytes();
        let tokens = bytes.iter().map(|b| (vec![*b], 0., 0.2, 0.9)).collect();
        let words = merge_tokens(tokens, 1.).unwrap();
        assert_eq!(words[0].text, "का");
    }
    #[test]
    fn merges_hindi_scalars_spanning_tokens_and_word_boundaries() {
        let text = "नमस्ते दोस्त hello";
        let tokens = text
            .as_bytes()
            .chunks(2)
            .enumerate()
            .map(|(i, bytes)| (bytes.to_vec(), i as f64 * 0.02, i as f64 * 0.02 + 0.02, 0.9))
            .collect();
        let words = merge_tokens(tokens, 2.).unwrap();
        assert_eq!(
            words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>(),
            ["नमस्ते", "दोस्त", "hello"]
        );
        assert!(words[1].start_time >= words[0].start_time);
    }
    #[test]
    fn malformed_or_truncated_model_bytes_preserve_other_words_for_review() {
        let tokens = vec![
            (b" hello ".to_vec(), 0., 0.5, 0.9),
            (vec![0xe0, 0xa4], 0.5, 0.6, 0.7),
            (b" world ".to_vec(), 0.6, 1., 0.9),
            (vec![0xe0], 1., 1.1, 0.7),
        ];
        let words = merge_tokens(tokens, 2.).unwrap();
        assert_eq!(
            words
                .iter()
                .map(|word| word.text.as_str())
                .collect::<Vec<_>>(),
            ["hello", "�", "world", "�"]
        );
        assert_eq!(words[1].start_time, 0.5);
        assert!(words[1].timing_needs_review);
    }
    #[test]
    fn rejects_unknown_timing_instead_of_even_spacing() {
        assert!(merge_tokens(vec![(b"hi".to_vec(), -1., 0., 0.5)], 1.).is_err());
    }
    #[test]
    fn abort_callback_uses_owned_storage_and_contains_panics() {
        let mut callbacks = Box::new(Callbacks {
            emit: Arc::new(|_, _| {}),
            abort: Arc::new(|| true),
            duration: 1.,
            state_address: std::sync::atomic::AtomicUsize::new(0),
            gpu_model: std::sync::atomic::AtomicBool::new(false),
        });
        assert!(unsafe { native_abort((&mut *callbacks as *mut Callbacks).cast()) });
        callbacks.abort = Arc::new(|| panic!("cancel callback failed"));
        assert!(unsafe { native_abort((&mut *callbacks as *mut Callbacks).cast()) });
    }
}
