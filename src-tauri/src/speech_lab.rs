//! Native, cancellable caption jobs. This module never mutates an editor project.
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::Write,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{Emitter, Manager};

#[derive(Clone, Default)]
pub struct SpeechJobs(Arc<Mutex<HashMap<String, Arc<AtomicBool>>>>);

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if !cfg!(debug_assertions) {
        return Err("Speech Lab is available only in development builds".into());
    }
    storage_root(app)
}
fn storage_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("speech-lab");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}
#[tauri::command]
pub fn speech_lab_environment(app: tauri::AppHandle) -> Result<Value, String> {
    let storage = root(&app)?;
    Ok(
        json!({ "storagePath": storage, "runtimePath":"in-process native", "runtimeInstalled":true }),
    )
}

#[tauri::command]
pub fn speech_lab_start(
    app: tauri::AppHandle,
    jobs: tauri::State<SpeechJobs>,
    job_id: String,
    request: Value,
) -> Result<(), String> {
    let storage = root(&app)?;
    if request["action"] == "catalog" {
        let value = json!([
            aiditor_speech::models::status(&storage, "tara").map_err(|e| e.to_string())?,
            aiditor_speech::models::status(&storage, "tara-q5_0").map_err(|e| e.to_string())?,
            aiditor_speech::models::status(&storage, "shruti").map_err(|e| e.to_string())?
        ]);
        app.emit(
            "speech-lab-event",
            json!({"jobId":job_id,"type":"result","data":value}),
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }
    if request["action"] == "hardware" {
        let detected = aiditor_speech::accelerator::hardware();
        let value = json!({"cpu":"Native CPU","logicalCpus":detected["cpuThreads"],"ramBytes":detected["cpu"]["totalMemoryBytes"],
            "cudaDevices":detected["cuda"]["devices"].as_array().map_or(0,Vec::len),"cpuComputeTypes":["GGML","int8_float32"],"cudaComputeTypes":[],
            "cudaError":detected["cuda"]["reason"],"gpu":null,"capabilities":detected});
        app.emit(
            "speech-lab-event",
            json!({"jobId":job_id,"type":"result","data":value}),
        )
        .map_err(|e| e.to_string())?;
        return Ok(());
    }
    if !matches!(
        request["action"].as_str(),
        Some("prepare" | "transcribe" | "download")
    ) {
        return Err("Unsupported native Speech Lab operation".into());
    }
    start_native(app, jobs, job_id, request, storage)
}

#[tauri::command]
pub fn auto_captions_start(
    app: tauri::AppHandle,
    jobs: tauri::State<SpeechJobs>,
    job_id: String,
    request: Value,
) -> Result<(), String> {
    if !caption_request_allowed(&request) {
        return Err("Unsupported auto captions operation".into());
    }
    let storage = storage_root(&app)?;
    start_native(app, jobs, job_id, request, storage)
}
fn start_native(
    app: tauri::AppHandle,
    jobs: tauri::State<SpeechJobs>,
    job_id: String,
    request: Value,
    storage: PathBuf,
) -> Result<(), String> {
    if job_id.is_empty()
        || job_id.len() > 80
        || !job_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-')
    {
        return Err("Invalid job ID".into());
    }
    let registry = jobs.0.clone();
    let cancelled = Arc::new(AtomicBool::new(false));
    {
        let mut map = registry.lock().map_err(|e| e.to_string())?;
        if !map.is_empty() {
            return Err("Another native caption job is still running".into());
        }
        map.insert(job_id.clone(), cancelled.clone());
    }
    let progress_app = app.clone();
    let progress_id = job_id.clone();
    let emit: aiditor_speech::Emit = Arc::new(move |kind, data| {
        let payload = json!({"jobId":progress_id,"type":kind,"data":data});
        let _ = progress_app.emit("speech-lab-event", &payload);
        let _ = progress_app.emit("speech-lab-progress", &payload);
    });
    std::thread::spawn(move || {
        // Foreign model code runs on an owned worker thread, never the UI thread.
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            aiditor_speech::run(&storage, request, emit, cancelled.clone())
        }));
        let (kind, data) = if cancelled.load(Ordering::SeqCst) {
            ("cancelled", json!({"message":"Cancelled"}))
        } else {
            match result {
                Ok(Ok(value)) => ("result", value),
                Ok(Err(error)) => ("error", json!({"message":error.to_string()})),
                Err(_) => ("error", json!({"message":"Native caption worker panicked"})),
            }
        };
        // Release the reservation before completion so a UI retry can start.
        if let Ok(mut map) = registry.lock() {
            map.remove(&job_id);
        }
        let payload = json!({"jobId":job_id,"type":kind,"data":data});
        let _ = app.emit("speech-lab-event", &payload);
        let _ = app.emit("speech-lab-progress", &payload);
    });
    Ok(())
}

fn caption_request_allowed(request: &Value) -> bool {
    match request["action"].as_str() {
        Some("caption_status") | Some("auto_captions") => true,
        Some("download") => matches!(request["model"].as_str(), Some("shruti") | Some("tara")),
        _ => false,
    }
}

#[tauri::command]
pub fn speech_lab_cancel(
    app: tauri::AppHandle,
    jobs: tauri::State<SpeechJobs>,
    job_id: String,
) -> Result<(), String> {
    root(&app)?;
    if let Some(cancel) = jobs.0.lock().map_err(|e| e.to_string())?.get(&job_id) {
        cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}
#[tauri::command]
pub fn auto_captions_cancel(
    app: tauri::AppHandle,
    jobs: tauri::State<SpeechJobs>,
    job_id: String,
) -> Result<(), String> {
    storage_root(&app)?;
    if let Some(cancel) = jobs.0.lock().map_err(|e| e.to_string())?.get(&job_id) {
        cancel.store(true, Ordering::SeqCst);
    }
    Ok(())
}
pub fn shutdown(jobs: &SpeechJobs) {
    if let Ok(map) = jobs.0.lock() {
        for cancel in map.values() {
            cancel.store(true, Ordering::SeqCst);
        }
    }
}

#[tauri::command]
pub async fn speech_lab_pick(app: tauri::AppHandle) -> Result<Option<String>, String> {
    root(&app)?;
    tauri::async_runtime::spawn_blocking(|| {
        rfd::FileDialog::new()
            .set_title("Speech Lab — Audio / Video")
            .add_filter(
                "Audio / Video",
                &[
                    "wav", "mp3", "aac", "m4a", "mp4", "mov", "mkv", "webm", "flac", "ogg",
                ],
            )
            .pick_file()
            .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn speech_lab_import_chunk(
    app: tauri::AppHandle,
    name: String,
    bytes: Vec<u8>,
    upload_id: Option<String>,
    done: bool,
) -> Result<Value, String> {
    let storage = root(&app)?.join("inputs");
    std::fs::create_dir_all(&storage).map_err(|e| e.to_string())?;
    if bytes.len() > 524288 {
        return Err("Import chunks must be at most 512 KiB".into());
    }
    let extension = std::path::Path::new(&name)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
    if ![
        "wav", "mp3", "aac", "m4a", "mp4", "mov", "mkv", "webm", "flac", "ogg",
    ]
    .contains(&extension.as_str())
    {
        return Err("Unsupported media extension".into());
    }
    let id = upload_id.unwrap_or_else(|| {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
            .to_string()
    });
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
        return Err("Invalid import ID".into());
    }
    let partial = storage.join(format!("{id}.{extension}.part"));
    let mut output = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&partial)
        .map_err(|e| e.to_string())?;
    output.write_all(&bytes).map_err(|e| e.to_string())?;
    drop(output);
    let path = storage.join(format!("{id}.{extension}"));
    if done {
        std::fs::rename(&partial, &path).map_err(|e| e.to_string())?;
    }
    Ok(json!({ "uploadId": id, "path": if done { Some(path) } else { None } }))
}

#[tauri::command]
pub async fn speech_lab_export(
    app: tauri::AppHandle,
    name: String,
    content: String,
) -> Result<Option<String>, String> {
    root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let file_name = std::path::Path::new(&name)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("transcript.json");
        if let Some(path) = rfd::FileDialog::new()
            .set_title("Export Speech Lab results")
            .set_file_name(file_name)
            .save_file()
        {
            std::fs::write(&path, content).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        } else {
            Ok(None)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
