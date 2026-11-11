pub mod accelerator;
pub mod alignment;
pub mod audio;
pub mod chunks;
pub mod convert;
pub mod cpu;
pub mod ct2;
pub mod ct2_convert;
pub mod engine;
pub mod features;
pub mod hardware;
pub mod models;
pub mod resources;
pub mod scheduler;
pub mod server;
pub mod vad;

use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Instant,
};

pub type Emit = Arc<dyn Fn(&str, Value) + Send + Sync>;
pub type Cancel = Arc<AtomicBool>;
pub fn check_cancel(cancel: &Cancel) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        bail!("Cancelled")
    } else {
        Ok(())
    }
}
pub fn cache_root() -> Result<PathBuf> {
    #[cfg(windows)]
    let base = PathBuf::from(
        std::env::var_os("LOCALAPPDATA")
            .ok_or_else(|| anyhow::anyhow!("LOCALAPPDATA is unavailable"))?,
    );
    #[cfg(target_os = "macos")]
    let base = PathBuf::from(
        std::env::var_os("HOME").ok_or_else(|| anyhow::anyhow!("HOME is unavailable"))?,
    )
    .join("Library/Application Support");
    #[cfg(all(not(windows), not(target_os = "macos")))]
    let base = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .filter(|p| p.is_absolute())
        .or_else(|| std::env::var_os("HOME").map(|p| PathBuf::from(p).join(".local/share")))
        .ok_or_else(|| anyhow::anyhow!("Application data directory is unavailable"))?;
    Ok(base.join("com.aiditor.app").join("speech-lab"))
}
pub fn hidden(command: &mut std::process::Command) {
    let _ = &command;
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Word {
    pub text: String,
    pub start_time: f64,
    pub end_time: f64,
    pub confidence: Option<f64>,
    pub timing_needs_review: bool,
}
pub fn validate_words(words: &[Word], duration: f64) -> Result<()> {
    let mut previous = 0.;
    for word in words {
        if word.text.trim().is_empty()
            || !word.start_time.is_finite()
            || !word.end_time.is_finite()
            || word.start_time < previous
            || word.start_time < 0.
            || word.end_time < word.start_time
            || word.end_time > duration + 0.1
        {
            bail!("Engine returned invalid word timings; no timestamps were synthesized")
        }
        previous = word.start_time;
    }
    Ok(())
}
pub fn run(root: &std::path::Path, request: Value, emit: Emit, cancel: Cancel) -> Result<Value> {
    let quick = request
        .get("quickMode")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    if let Some(value) = request.get("quickMode") {
        if !value.is_boolean() {
            bail!("quickMode must be a boolean")
        }
    }
    let model = if quick { "shruti" } else { "tara" };
    match request["action"].as_str().unwrap_or("") {
        "caption_status" => models::status(root, model),
        "download" => {
            let selected = match request["model"].as_str() {
                Some("tara") => "tara",
                Some("tara-q5_0") => "tara-q5_0",
                Some("shruti") => "shruti",
                _ => bail!("Unsupported native model"),
            };
            models::install(root, selected, &emit, &cancel)?;
            Ok(json!([models::status(root, selected)?]))
        }
        "prepare" => {
            let path = PathBuf::from(
                request["path"]
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("Missing input path"))?,
            );
            let prepared = audio::prepare_file(root, &path, &emit, &cancel)?;
            Ok(
                json!({"path":path,"audioPath":prepared.path,"name":path.file_name().map(|n|n.to_string_lossy()),"audioSha256":prepared.sha256,"duration":prepared.duration(),"sampleRate":16000}),
            )
        }
        "auto_captions" | "transcribe" => {
            if !["auto", "cpu", "cuda", "vulkan", "metal"]
                .contains(&request["device"].as_str().unwrap_or("auto"))
            {
                bail!("Unsupported inference device");
            }
            if request["action"] == "auto_captions" && request.get("diagnostics").is_some() {
                bail!("Diagnostic settings are only supported for read-only file transcription")
            }
            let started = Instant::now();
            let prepared = if request["action"] == "auto_captions" {
                audio::prepare_plan(
                    root,
                    serde_json::from_value(request["plan"].clone())?,
                    &emit,
                    &cancel,
                )?
            } else {
                audio::prepare_file(
                    root,
                    &PathBuf::from(
                        request["path"]
                            .as_str()
                            .ok_or_else(|| anyhow::anyhow!("Missing input path"))?,
                    ),
                    &emit,
                    &cancel,
                )?
            };
            let preparation = started.elapsed().as_secs_f64();
            let selected = request["model"].as_str().unwrap_or(model);
            let selected = if ["tara", "tara-q5_0"].contains(&selected) {
                selected
            } else if selected == "shruti" {
                "shruti"
            } else {
                bail!("Unsupported model")
            };
            let decoded =
                engine::transcribe(root, selected, &prepared.samples, &request, &emit, &cancel)?;
            validate_words(&decoded.words, prepared.duration())?;
            let mut versions = json!({"engine":"aiditor-native-v3"});
            if decoded.native_profile["engine"] == "ctranslate2" {
                versions["ctranslate2"] = json!("4.8.4");
            } else if selected == "shruti" {
                versions["needle"] = json!("3.3.3");
            } else {
                versions["whisperRs"] = json!("0.16.0");
            }
            Ok(
                json!({"id":uuid::Uuid::new_v4().to_string(), "model":selected,
                "language":decoded.language,"languageProbability":null,"text":decoded.text,"words":decoded.words,"segments":decoded.segments,
                "source":{"path":prepared.path,"audioPath":prepared.path,"name":"Cached project audio","audioSha256":prepared.sha256,"duration":prepared.duration(),"sampleRate":16000},
                "rawResponse":{"engine":"native", "warnings":decoded.warnings},
                "processingMetadata":{"processingSec":started.elapsed().as_secs_f64(),"audioPreparationSec":preparation,
                    "inferenceSec":decoded.inference_sec,"modelLoadSec":decoded.load_sec,"modelVerificationSec":decoded.verification_sec,"audioDurationSec":prepared.duration(),
                    "realTimeFactor":started.elapsed().as_secs_f64()/prepared.duration(),"device":decoded.device,"requestedDevice":request["device"].as_str().unwrap_or("auto"),
                    "fallback":decoded.fallback,"computeType":decoded.compute_type,"model":selected,"modelRevision":decoded.revision,
                    "runtimeVersions":versions,"inferenceEngine":decoded.native_profile["engine"].as_str().unwrap_or(if selected == "shruti" {"needle"}else{"whisper-cpp"}),"conditionOnPreviousText":false,"languageHint":request["language"].as_str().unwrap_or("hi"),"vad":false,"vadSilenceMs":null,
                    "wordTimestamps":decoded.native_profile["alignmentEnabled"].as_bool().unwrap_or(true),"nativeProfile":decoded.native_profile,"wordTimestampsAvailable":!decoded.words.is_empty(),"coldWorker":true,"warnings":decoded.warnings,
                    "peakRamBytes":0,"cpuPercentMachine":0,"gpuPercentDevice":null,"peakVramMiBDevice":null,"resourceMetricsAvailable":false}}),
            )
        }
        _ => bail!("Unsupported native caption operation"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_invalid_timestamps() {
        let mut word = Word {
            text: "hello".into(),
            start_time: 0.,
            end_time: 1.,
            confidence: None,
            timing_needs_review: false,
        };
        assert!(validate_words(&[word.clone()], 2.).is_ok());
        word.start_time = f64::NAN;
        assert!(validate_words(&[word], 2.).is_err());
    }
    #[test]
    fn cancellation_is_cooperative() {
        assert!(check_cancel(&Arc::new(AtomicBool::new(true))).is_err());
    }
    #[test]
    fn diagnostics_cannot_disable_timing_for_project_captions() {
        let error = run(
            std::path::Path::new("unused"),
            json!({"action":"auto_captions","diagnostics":{"alignment":false}}),
            Arc::new(|_, _| {}),
            Arc::new(AtomicBool::new(false)),
        )
        .unwrap_err();
        assert!(error.to_string().contains("read-only file transcription"));
    }
}
