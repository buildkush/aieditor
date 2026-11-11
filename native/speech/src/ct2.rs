//! Optional CT2 CPU pack. Base executable has no CT2/MKL startup dependencies.
use crate::{Cancel, Emit, Word, check_cancel, engine::Decoded};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{
    ffi::{CStr, CString, c_char, c_void},
    fs::{self, File},
    path::Path,
    sync::atomic::{AtomicUsize, Ordering},
    time::Instant,
};
pub const ABI: &str = "aiditor-ct2-4.8.4-tara-v1";
pub fn library_name() -> &'static str {
    if cfg!(windows) {
        "aiditor_ct2.dll"
    } else if cfg!(target_os = "macos") {
        "libaiditor_ct2.dylib"
    } else {
        "libaiditor_ct2.so"
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn word_alignment_preserves_source_clock_and_rejects_missing_evidence() {
        let vocabulary = vec![b" hello".to_vec(), b" world".to_vec()];
        let mut result =
            json!({"tokens":[0,1],"alignments":[[0,0],[1,5],[2,20]],"probabilities":[0.9,0.8]});
        let words = aligned_words(&result, &vocabulary, 0.4, 8.).unwrap();
        assert_eq!(words[0].start_time, 8.);
        assert_eq!(words[1].end_time, 8.4);
        result["alignments"] = json!([[0, 0], [1, 5]]);
        assert!(aligned_words(&result, &vocabulary, 0.4, 8.).is_err());
        result["alignments"] = json!([[0, 0], [1, 5], [2, 4]]);
        assert!(aligned_words(&result, &vocabulary, 0.4, 8.).is_err());
    }
}
pub fn model_path(root: &Path) -> std::path::PathBuf {
    root.join("models/tara-ct2-int8")
}
pub fn model_marker(root: &Path, hash: bool) -> Result<Value> {
    let folder = model_path(root);
    let marker: Value = serde_json::from_reader(File::open(folder.join("installed.json"))?)?;
    if marker["format"] != "aiditor-tara-ct2-v1"
        || marker["nMels"] != 128
        || marker["mixedcodeToken"] != 51866
        || marker["computeType"] != "int8_float32"
        || marker["sourceRevision"] != "4dd4782d65ed8c9690b52478e4419d577fff40be"
    {
        bail!("CT2 Tara model metadata mismatch");
    }
    let files = marker["files"]
        .as_array()
        .context("Missing CT2 model files")?;
    for name in ["model.bin", "vocabulary.json", "config.json"] {
        let file = files
            .iter()
            .find(|f| f["name"] == name)
            .context("Missing CT2 model member")?;
        let path = folder.join(name);
        if file["size"].as_u64() != Some(fs::metadata(&path)?.len())
            || (hash
                && !crate::models::verified_tara_hash(
                    &path,
                    file["sha256"].as_str().unwrap_or(""),
                )?)
        {
            bail!("CT2 Tara checksum/size mismatch: {name}");
        }
    }
    Ok(marker)
}
pub fn pack_ready(root: &Path) -> bool {
    pack_manifest(root, false).is_ok()
}
pub fn verify(root: &Path, emit: &Emit, cancel: &Cancel) -> Result<Value> {
    let _lease = crate::resources::acquire(root, emit, cancel)?;
    model_marker(root, true)?;
    pack_manifest(root, true)?;
    check_cancel(cancel)?;
    let _engine = Engine::load(root, crate::cpu::inference_threads(), 1)?;
    Ok(
        json!({"loaded":true,"engine":"ctranslate2","computeType":"int8_float32",
        "mixedcodeToken":51866,"nMels":128,"inferencePerformed":false}),
    )
}
fn pack_manifest(root: &Path, hash: bool) -> Result<Value> {
    let folder = root.join("runtime/ct2-cpu");
    let manifest: Value = serde_json::from_reader(File::open(folder.join("manifest.json"))?)?;
    crate::accelerator::validate_manifest(&manifest)?;
    if manifest["backend"] != "ct2-cpu" {
        bail!("Not a CT2 CPU pack");
    }
    let files = manifest["files"]
        .as_array()
        .context("Missing CT2 runtime files")?;
    if !files.iter().any(|f| f["name"] == library_name()) {
        bail!("Missing CT2 bridge");
    }
    for file in files {
        let name = file["name"].as_str().context("Missing runtime filename")?;
        if !crate::accelerator::safe_relative(name) {
            bail!("Unsafe CT2 runtime filename");
        }
        let path = folder.join(name);
        if file["size"].as_u64() != Some(fs::metadata(&path)?.len())
            || (hash
                && !crate::models::verified_tara_hash(
                    &path,
                    file["sha256"].as_str().unwrap_or(""),
                )?)
        {
            bail!("CT2 runtime checksum/size mismatch: {name}");
        }
    }
    Ok(manifest)
}
type Open = unsafe extern "C" fn(*const c_char, usize, usize, *mut *mut c_char) -> *mut c_void;
type Close = unsafe extern "C" fn(*mut c_void);
type Free = unsafe extern "C" fn(*mut c_char);
type Chunk = unsafe extern "C" fn(
    *mut c_void,
    *const f32,
    usize,
    usize,
    i32,
    bool,
    extern "C" fn(*mut c_void) -> bool,
    *mut c_void,
) -> *mut c_char;
struct Engine {
    handle: *mut c_void,
    chunk: Chunk,
    close: Close,
    free: Free,
    _library: libloading::Library,
}
// CT2 ReplicaPool::post is designed for concurrent callers. The library and pool
// outlive all scoped workers; destruction happens only after every worker joins.
unsafe impl Send for Engine {}
unsafe impl Sync for Engine {}
impl Drop for Engine {
    fn drop(&mut self) {
        unsafe {
            (self.close)(self.handle);
        }
    }
}
impl Engine {
    fn load(root: &Path, threads: usize, workers: usize) -> Result<Self> {
        let folder = root.join("runtime/ct2-cpu");
        unsafe {
            #[cfg(windows)]
            let library: libloading::Library = libloading::os::windows::Library::load_with_flags(
                folder.join(library_name()),
                0x00000100 | 0x00001000,
            )?
            .into();
            #[cfg(not(windows))]
            let library = libloading::Library::new(folder.join(library_name()))?;
            let abi =
                library.get::<unsafe extern "C" fn() -> *const c_char>(b"aiditor_ct2_abi_v1\0")?;
            if CStr::from_ptr(abi()).to_bytes() != ABI.as_bytes() {
                bail!("Loaded CT2 library ABI mismatch");
            }
            let open: Open = *library.get(b"aiditor_ct2_open_v1\0")?;
            let close: Close = *library.get(b"aiditor_ct2_close_v1\0")?;
            let free: Free = *library.get(b"aiditor_ct2_free_v1\0")?;
            let chunk: Chunk = *library.get(b"aiditor_ct2_chunk_v1\0")?;
            let path = CString::new(
                model_path(root)
                    .to_str()
                    .context("Invalid CT2 model path")?,
            )?;
            let mut error = std::ptr::null_mut();
            let handle = open(path.as_ptr(), threads, workers, &mut error);
            let error = if error.is_null() {
                None
            } else {
                let text = CStr::from_ptr(error).to_string_lossy().into_owned();
                free(error);
                Some(text)
            };
            if handle.is_null() {
                bail!(
                    "Cannot initialize native CT2: {}",
                    error.unwrap_or_else(|| "No error returned".into())
                );
            }
            Ok(Self {
                handle,
                chunk,
                close,
                free,
                _library: library,
            })
        }
    }
    fn infer(
        &self,
        features: &[f32],
        frames: usize,
        language: i32,
        aligned: bool,
        cancel: &Cancel,
    ) -> Result<Value> {
        extern "C" fn abort(user: *mut c_void) -> bool {
            unsafe { &*(user as *const std::sync::atomic::AtomicBool) }.load(Ordering::Relaxed)
        }
        let pointer = unsafe {
            (self.chunk)(
                self.handle,
                features.as_ptr(),
                features.len(),
                frames,
                language,
                aligned,
                abort,
                std::sync::Arc::as_ptr(cancel).cast_mut().cast(),
            )
        };
        if pointer.is_null() {
            bail!("Native CT2 returned no payload");
        }
        let bytes = unsafe { CStr::from_ptr(pointer) }.to_bytes().to_vec();
        unsafe {
            (self.free)(pointer);
        }
        let result: Value = serde_json::from_slice(&bytes)?;
        if let Some(error) = result.get("error") {
            bail!("Native CT2: {error}");
        }
        Ok(result)
    }
}
fn aligned_words(
    result: &Value,
    vocabulary: &[Vec<u8>],
    duration: f64,
    offset: f64,
) -> Result<Vec<Word>> {
    let ids = result["tokens"].as_array().context("Missing CT2 tokens")?;
    let mut jumps = std::collections::BTreeMap::new();
    let mut previous = (0, 0);
    for pair in result["alignments"]
        .as_array()
        .context("Missing CT2 alignment")?
    {
        let t = pair[0].as_u64().context("Invalid CT2 token index")? as usize;
        let frame = pair[1].as_u64().context("Invalid CT2 frame index")? as usize;
        if t < previous.0
            || frame < previous.1
            || t > ids.len()
            || frame as f64 * 0.02 > duration + 0.03
        {
            bail!("CT2 returned a nonmonotonic or out-of-range alignment");
        }
        jumps.entry(t).or_insert(frame as f64 * 0.02);
        previous = (t, frame);
    }
    let mut timed = vec![];
    for (index, id) in ids.iter().enumerate() {
        let id = id.as_u64().context("Invalid CT2 token")? as usize;
        let begin = *jumps
            .get(&index)
            .context("CT2 token start is unavailable")?;
        let end = *jumps
            .get(&(index + 1))
            .context("CT2 token end is unavailable")?;
        let p = result["probabilities"][index]
            .as_f64()
            .context("CT2 token confidence unavailable")?;
        if !p.is_finite() || !(0. ..=1.).contains(&p) {
            bail!("Invalid CT2 confidence");
        }
        timed.push((
            vocabulary
                .get(id)
                .context("CT2 token outside vocabulary")?
                .clone(),
            begin.min(duration),
            end.min(duration),
            p,
        ));
    }
    let mut words = crate::engine::merge_tokens(timed, duration)?;
    for word in &mut words {
        word.start_time += offset;
        word.end_time += offset;
    }
    Ok(words)
}
pub fn transcribe(
    root: &Path,
    samples: &[f32],
    request: &Value,
    emit: &Emit,
    cancel: &Cancel,
) -> Result<Decoded> {
    check_cancel(cancel)?;
    let verification = Instant::now();
    model_marker(root, true)?;
    pack_manifest(root, true)?;
    let vocabulary: Vec<String> =
        serde_json::from_reader(File::open(model_path(root).join("vocabulary.json"))?)?;
    let vocabulary: Vec<Vec<u8>> = vocabulary
        .iter()
        .enumerate()
        .map(|(i, t)| {
            if i < 50257 {
                crate::convert::token_bytes(t)
            } else {
                Ok(t.as_bytes().to_vec())
            }
        })
        .collect::<Result<_>>()?;
    let verification_sec = verification.elapsed().as_secs_f64();
    let cpu = crate::cpu::topology();
    emit(
        "progress",
        json!({"stage":"chunking","message":"Finding speech boundaries; all recognition audio is retained"}),
    );
    let planning = Instant::now();
    let speech = crate::vad::speech(root, samples, cpu.core_budget, cancel)?;
    let chunks = crate::chunks::plan(samples.len(), &speech)?;
    let planning_sec = planning.elapsed().as_secs_f64();
    let mut schedule = crate::scheduler::plan(
        &cpu,
        chunks.len(),
        fs::metadata(model_path(root).join("model.bin"))?
            .len()
            .saturating_mul(2),
        512 << 20,
    );
    if let Some(threads) = request["diagnostics"]["threads"].as_u64() {
        if threads == 0 || threads > 256 {
            bail!("Diagnostic CPU budget must be 1..256");
        }
        schedule.core_budget = threads as usize;
        schedule.workers = schedule.workers.min(threads as usize);
        schedule.threads_per_worker = (threads as usize / schedule.workers).max(1);
    }
    let aligned = request["diagnostics"]["alignment"]
        .as_bool()
        .unwrap_or(true);
    let language = match request["language"].as_str().unwrap_or("hi") {
        "hi" => 50276,
        "en" => 50259,
        "auto" => 0,
        _ => bail!("Supported language hints: hi, en, auto"),
    };
    emit(
        "progress",
        json!({"stage":"loading","message":format!("Loading native CT2: {} workers × {} threads",schedule.workers,schedule.threads_per_worker)}),
    );
    let loading = Instant::now();
    let engine = Engine::load(root, schedule.threads_per_worker, schedule.workers)?;
    let load_sec = loading.elapsed().as_secs_f64();
    let next = AtomicUsize::new(0);
    let completed = AtomicUsize::new(0);
    let inference = Instant::now();
    let results = std::thread::scope(|scope| -> Result<Vec<(usize, Value, Vec<Word>, String)>> {
        let mut handles = vec![];
        for _ in 0..schedule.workers {
            let speech = &speech;
            let (engine, chunks, next, completed, vocabulary) =
                (&engine, &chunks, &next, &completed, &vocabulary);
            handles.push(scope.spawn(move || -> Result<Vec<(usize,Value,Vec<Word>,String)>> {
                let mut output = vec![];
                loop {
                    check_cancel(cancel)?;
                    let index = next.fetch_add(1,Ordering::Relaxed);
                    let Some(chunk) = chunks.get(index) else { break; };
                    let audio = &samples[chunk.input_start..chunk.input_end];
                    let features = crate::features::log_mel(audio)?;
                    let mut result = engine.infer(&features,audio.len().div_ceil(160),language,aligned,cancel)?;
                    let mut bytes = vec![];
                    for token in result["tokens"].as_array().context("Missing tokens")? {
                        let id = token.as_u64().context("Invalid token ID")? as usize;
                        bytes.extend_from_slice(vocabulary.get(id).context("Unknown token ID")?);
                    }
                    let text = String::from_utf8_lossy(&bytes).into_owned();
                    let mut words = if aligned { aligned_words(&result,vocabulary,audio.len() as f64/16000.,chunk.input_start as f64/16000.)? } else { vec![] };
                    if aligned {
                        let (changes,unresolved) = crate::alignment::constrain(&mut words,speech,samples.len() as f64/16000.);
                        result["wordTimingAdjustments"] = json!(changes);
                        result["unconstrainedWordTimings"] = json!(unresolved);
                    }
                    let count = completed.fetch_add(1,Ordering::Relaxed) + 1;
                    emit("progress",json!({"stage":"transcribing","completed":count,"total":chunks.len(),"message":text,
                        "partialSegment":{"text":text,"words":words,"provisional":true}}));
                    output.push((index,result,words,text));
                }
                Ok(output)
            }));
        }
        let mut result = vec![];
        let mut error = None;
        for handle in handles {
            match handle
                .join()
                .unwrap_or_else(|_| Err(anyhow::anyhow!("CT2 chunk worker panicked")))
            {
                Ok(items) => result.extend(items),
                Err(e) => {
                    if error.is_none() {
                        error = Some(e);
                    }
                }
            }
        }
        if let Some(e) = error {
            return Err(e);
        }
        result.sort_by_key(|r| r.0);
        Ok(result)
    })?;
    check_cancel(cancel)?;
    let cpu_backend = results
        .first()
        .and_then(|r| r.1["cpuBackend"].as_str())
        .unwrap_or("unknown")
        .to_owned();
    let mut words: Vec<Word> = vec![];
    let mut segments = vec![];
    let mut warnings = vec![
        "Native CT2 INT8 is lossy. Word timestamps are attention/DTW estimates and require review."
            .to_owned(),
    ];
    let mut capped = 0;
    let (mut encoder, mut generation, mut alignment) = (0., 0., 0.);
    for (index, result, incoming, text) in results {
        let c = &chunks[index];
        encoder += result["encoderSec"].as_f64().unwrap_or(0.);
        generation += result["generationDecoderSec"].as_f64().unwrap_or(0.);
        alignment += result["alignmentSec"].as_f64().unwrap_or(0.);
        if result["tokenLimitHit"] == true {
            capped += 1;
        }
        if result["unconstrainedWordTimings"].as_u64().unwrap_or(0) > 0 {
            warnings.push(format!("Chunk {} has ambiguous speech boundaries; native word intervals are retained for review.",index+1));
        }
        let mut duplicate = 0;
        // Remove only an exact multiword suffix/prefix with matching acoustic times.
        for count in 2..=16.min(words.len()).min(incoming.len()) {
            let prior = &words[words.len() - count..];
            let new = &incoming[..count];
            if prior.iter().all(|w| w.text.trim() == prior[0].text.trim()) {
                continue;
            }
            if prior.iter().zip(new).all(|(a, b)| {
                a.text.trim() == b.text.trim()
                    && ((a.start_time + a.end_time - b.start_time - b.end_time) / 2.).abs() <= 0.2
            }) {
                duplicate = count;
            }
        }
        if index > 0 && c.input_start < c.core_start && duplicate == 0 {
            warnings.push(format!(
                "Ambiguous overlap near {:.2}s; both hypotheses retained for review.",
                c.core_start as f64 / 16000.
            ));
        }
        segments.push(json!({"id":index,"text":text,"startTime":c.input_start as f64/16000.,"endTime":c.input_end as f64/16000.,
            "words":incoming,"tokens":result["tokens"],"nativeProfile":result,"duplicateWordsRemoved":duplicate}));
        words.extend(incoming.into_iter().skip(duplicate));
    }
    if capped > 0 {
        warnings.push("A chunk reached Tara's decoder budget; review transcript coverage.".into());
    }
    // Preserve ambiguous hypotheses, with actual acoustic timestamps in source order.
    words.sort_by(|a, b| a.start_time.total_cmp(&b.start_time));
    let text = if aligned {
        words
            .iter()
            .map(|w| w.text.as_str())
            .collect::<Vec<_>>()
            .join(" ")
    } else {
        segments
            .iter()
            .filter_map(|s| s["text"].as_str())
            .collect::<Vec<_>>()
            .join(" ")
    };
    Ok(Decoded {
        text,
        words,
        segments,
        language: if language == 50259 {
            Some("en".into())
        } else if language == 0 {
            None
        } else {
            Some("hi".into())
        },
        device: "cpu".into(),
        compute_type: "int8_float32".into(),
        revision: "4dd4782d65ed8c9690b52478e4419d577fff40be".into(),
        warnings,
        fallback: None,
        load_sec,
        verification_sec,
        inference_sec: inference.elapsed().as_secs_f64(),
        native_profile: json!({"engine":"ctranslate2","version":"4.8.4","cpuBackend":cpu_backend,"platform":crate::hardware::platform(),"cpu":cpu,"schedule":schedule,"threads":schedule.core_budget,"temperatureFallback":false,
            "alignmentEnabled":aligned,"chunkPlanningSec":planning_sec,"chunkCount":chunks.len(),"chunkingStrategy":"speech-aware-overlap-v1",
            "speechIntervals":speech,"chunks":chunks,"encoderSec":encoder,"generationDecoderSec":generation,"alignmentSec":alignment,
            "timingBasis":"sum-of-chunk-wall-times; stages overlap across workers","tokenLimitHits":capped,"decodeRetries":0}),
    })
}
