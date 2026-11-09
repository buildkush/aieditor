//! Development-only local process gateway. This module never reads or mutates an editor project.
use serde_json::{json, Value};
use std::{collections::HashMap, io::{BufRead, BufReader, Write}, path::PathBuf,
    process::{Child, Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{SystemTime, UNIX_EPOCH}};
use tauri::{Emitter, Manager};

struct Job { child: Arc<Mutex<Child>>, cancelled: Arc<AtomicBool>, captions: bool }
#[derive(Clone, Default)]
pub struct SpeechJobs(Arc<Mutex<HashMap<String, Job>>>);

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if !cfg!(debug_assertions) { return Err("Speech Lab is available only in development builds".into()); }
    storage_root(app)
}
fn storage_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("speech-lab");
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}
fn worker_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let local = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../speech-lab/backend/worker.py");
    if cfg!(debug_assertions) && local.is_file() { return Ok(local); }
    let bundled = app.path().resource_dir().map_err(|e| e.to_string())?.join("speech-backend/worker.py");
    if bundled.is_file() { return Ok(bundled); }
    Err("The local speech worker is missing. Reinstall aiditor or use its development build.".into())
}
fn python() -> PathBuf {
    if let Some(path) = std::env::var_os("AIDITOR_SPEECH_PYTHON") { return PathBuf::from(path); }
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../.speech-lab-venv").join(
        if cfg!(windows) { "Scripts/python.exe" } else { "bin/python" })
}
fn worker_python(storage: &std::path::Path) -> PathBuf {
    if std::env::var_os("AIDITOR_SPEECH_PYTHON").is_some() { return python(); }
    let local = python();
    if cfg!(debug_assertions) && local.is_file() { return local; }
    let runtime = storage.join("runtime").join(if cfg!(windows) { "Scripts/python.exe" } else { "bin/python" });
    if runtime.is_file() || !local.is_file() { runtime } else { local }
}
fn hidden(command: &mut Command) {
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    #[cfg(not(windows))] let _ = command;
}

fn terminate_worker(child: &mut Child) -> std::io::Result<()> {
    if child.try_wait()?.is_some() { return Ok(()); }
    // Windows venv python.exe is a launcher with a Python child. Killing just
    // the launcher leaves native inference running and its stdout pipe open.
    #[cfg(windows)] {
        let mut stop = Command::new("taskkill");
        hidden(&mut stop);
        if stop.args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|status| status.success()) {
            return Ok(());
        }
    }
    child.kill()
}

#[tauri::command]
pub fn speech_lab_environment(app: tauri::AppHandle) -> Result<Value, String> {
    let storage = root(&app)?;
    let executable = worker_python(&storage);
    Ok(json!({ "storagePath": storage, "pythonPath": executable, "runtimeInstalled": executable.is_file() }))
}

#[tauri::command]
pub fn speech_lab_start(app: tauri::AppHandle, jobs: tauri::State<SpeechJobs>, job_id: String, request: Value) -> Result<(), String> {
    let storage = root(&app)?;
    start_worker(app, jobs, job_id, request, storage, false)
}

#[tauri::command]
pub fn auto_captions_start(app: tauri::AppHandle, jobs: tauri::State<SpeechJobs>, job_id: String, request: Value) -> Result<(), String> {
    if !caption_request_allowed(&request) { return Err("Unsupported auto captions operation".into()); }
    let storage = storage_root(&app)?;
    start_worker(app, jobs, job_id, request, storage, true)
}

fn caption_request_allowed(request: &Value) -> bool {
    match request["action"].as_str() {
        Some("caption_status") | Some("auto_captions") => true,
        Some("download") => matches!(request["model"].as_str(), Some("shruti") | Some("tara-int8")),
        _ => false,
    }
}

fn start_worker(app: tauri::AppHandle, jobs: tauri::State<SpeechJobs>, job_id: String, request: Value, storage: PathBuf, captions: bool) -> Result<(), String> {
    if job_id.is_empty() || job_id.len() > 80 || !job_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("Invalid job ID".into());
    }
    let executable = worker_python(&storage);
    if !executable.is_file() {
        let setup = if cfg!(debug_assertions) { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../scripts/setup-speech-lab.ps1") }
            else { app.path().resource_dir().map_err(|e| e.to_string())?.join("speech-setup/scripts/setup-speech-lab.ps1") };
        return Err(format!("Install the local speech runtime: powershell -File \"{}\" -AppData. Or set AIDITOR_SPEECH_PYTHON to a compatible Python environment.", setup.display()));
    }
    let mut registry = jobs.0.lock().map_err(|e| e.to_string())?;
    if !registry.is_empty() { return Err("Another Speech Lab operation is still running".into()); }
    let mut command = Command::new(executable);
    command.arg("-u").arg(worker_path(&app)?)
        .arg(storage).env("PYTHONIOENCODING", "utf-8").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    hidden(&mut command);
    let mut child = command.spawn().map_err(|e| format!("Cannot start speech worker: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(error) = stdin.write_all(request.to_string().as_bytes()) { let _ = terminate_worker(&mut child); let _ = child.wait(); return Err(error.to_string()); }
    }
    let stdout = child.stdout.take().ok_or("Worker stdout unavailable")?;
    let stderr = child.stderr.take().ok_or("Worker stderr unavailable")?;
    let child = Arc::new(Mutex::new(child));
    let cancelled = Arc::new(AtomicBool::new(false));
    registry.insert(job_id.clone(), Job { child: child.clone(), cancelled: cancelled.clone(), captions });
    let registry = jobs.0.clone();
    std::thread::spawn(move || {
        let error_reader = std::thread::spawn(move || {
            // Drain all stderr to avoid pipe deadlock; retain a bounded tail for crash diagnostics.
            let mut tail = String::new();
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                tail.push_str(&line); tail.push('\n');
                if tail.len() > 65536 { tail = tail.chars().rev().take(16000).collect::<String>().chars().rev().collect(); }
            }
            tail
        });
        let mut terminal = None;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Ok(event) = serde_json::from_str::<Value>(&line) {
                if event["type"] == "progress" {
                    let _ = app.emit("speech-lab-event", json!({"jobId": job_id, "type": "progress", "data": event["data"]}));
                } else { terminal = Some(event); }
            }
        }
        let success = child.lock().ok().and_then(|mut c| c.wait().ok()).is_some_and(|s| s.success());
        let diagnostics = error_reader.join().unwrap_or_default();
        if let Ok(mut map) = registry.lock() { map.remove(&job_id); }
        let event = if cancelled.load(Ordering::SeqCst) { json!({"type": "cancelled", "data": {"message": "Cancelled; partial model downloads can be resumed"}}) }
            else if let Some(event) = terminal { event }
            else { json!({"type": "error", "data": {"message": format!("Speech worker exited unexpectedly (success={success}). {diagnostics}")}}) };
        let _ = app.emit("speech-lab-event", json!({"jobId": job_id, "type": event["type"], "data": event["data"]}));
    });
    Ok(())
}

#[tauri::command]
pub fn speech_lab_cancel(app: tauri::AppHandle, jobs: tauri::State<SpeechJobs>, job_id: String) -> Result<(), String> {
    root(&app)?;
    cancel_job(jobs, job_id, false)
}
#[tauri::command]
pub fn auto_captions_cancel(app: tauri::AppHandle, jobs: tauri::State<SpeechJobs>, job_id: String) -> Result<(), String> {
    storage_root(&app)?;
    cancel_job(jobs, job_id, true)
}
fn cancel_job(jobs: tauri::State<SpeechJobs>, job_id: String, captions: bool) -> Result<(), String> {
    if let Some(job) = jobs.0.lock().map_err(|e| e.to_string())?.get(&job_id) {
        if job.captions != captions { return Err("The job belongs to a different speech workflow".into()); }
        job.cancelled.store(true, Ordering::SeqCst);
        let mut child = job.child.lock().map_err(|e| e.to_string())?;
        terminate_worker(&mut child).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn shutdown(jobs: &SpeechJobs) {
    if let Ok(map) = jobs.0.lock() { for job in map.values() { if let Ok(mut child) = job.child.lock() { let _ = terminate_worker(&mut child); } } }
}

#[tauri::command]
pub async fn speech_lab_pick(app: tauri::AppHandle) -> Result<Option<String>, String> {
    root(&app)?;
    tauri::async_runtime::spawn_blocking(|| rfd::FileDialog::new().set_title("Speech Lab — Audio / Video")
        .add_filter("Audio / Video", &["wav", "mp3", "aac", "m4a", "mp4", "mov", "mkv", "webm", "flac", "ogg"])
        .pick_file().map(|p| p.to_string_lossy().into_owned())).await.map_err(|e| e.to_string())
}

#[tauri::command]
pub fn speech_lab_import_chunk(app: tauri::AppHandle, name: String, bytes: Vec<u8>, upload_id: Option<String>, done: bool) -> Result<Value, String> {
    let storage = root(&app)?.join("inputs");
    std::fs::create_dir_all(&storage).map_err(|e| e.to_string())?;
    if bytes.len() > 524288 { return Err("Import chunks must be at most 512 KiB".into()); }
    let extension = std::path::Path::new(&name).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    if !["wav", "mp3", "aac", "m4a", "mp4", "mov", "mkv", "webm", "flac", "ogg"].contains(&extension.as_str()) { return Err("Unsupported media extension".into()); }
    let id = upload_id.unwrap_or_else(|| SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos().to_string());
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) { return Err("Invalid import ID".into()); }
    let partial = storage.join(format!("{id}.{extension}.part"));
    let mut output = std::fs::OpenOptions::new().create(true).append(true).open(&partial).map_err(|e| e.to_string())?;
    output.write_all(&bytes).map_err(|e| e.to_string())?;
    drop(output);
    let path = storage.join(format!("{id}.{extension}"));
    if done { std::fs::rename(&partial, &path).map_err(|e| e.to_string())?; }
    Ok(json!({ "uploadId": id, "path": if done { Some(path) } else { None } }))
}

#[tauri::command]
pub async fn speech_lab_export(app: tauri::AppHandle, name: String, content: String) -> Result<Option<String>, String> {
    root(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let file_name = std::path::Path::new(&name).file_name().and_then(|s| s.to_str()).unwrap_or("transcript.json");
        if let Some(path) = rfd::FileDialog::new().set_title("Export Speech Lab results").set_file_name(file_name).save_file() {
            std::fs::write(&path, content).map_err(|e| e.to_string())?;
            Ok(Some(path.to_string_lossy().into_owned()))
        } else { Ok(None) }
    }).await.map_err(|e| e.to_string())?
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn captions_do_not_expose_development_lab_operations() {
        assert!(caption_request_allowed(&json!({"action": "caption_status"})));
        assert!(caption_request_allowed(&json!({"action": "auto_captions", "plan": {"projectId": "project"}})));
        assert!(caption_request_allowed(&json!({"action": "download", "model": "shruti"})));
        assert!(caption_request_allowed(&json!({"action": "download", "model": "tara-int8"})));
        for request in [json!({"action": "download", "model": "small"}), json!({"action": "transcribe", "model": "small"}),
            json!({"action": "catalog"}), json!({"action": "remove", "model": "shruti"}), json!({"action": "initialize", "model": "shruti"})] {
            assert!(!caption_request_allowed(&request));
        }
    }

    #[test]
    fn cancellation_terminates_python_descendants() {
        // Only inert sleeps: this exercises the real venv launcher/process tree,
        // without loading a recognition model or opening an audio file.
        let mut command = Command::new(python());
        hidden(&mut command);
        let mut child = command.args(["-u", "-c", "import subprocess,sys,time; p=subprocess.Popen([sys.executable,'-c','import time; time.sleep(60)']); print(p.pid,flush=True); time.sleep(60)"])
            .stdout(Stdio::piped()).stderr(Stdio::null()).spawn().expect("Speech Lab Python runtime");
        let mut pid_line = String::new();
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut pid_line).unwrap();
        let descendant: u32 = pid_line.trim().parse().unwrap();
        let result = terminate_worker(&mut child);
        let _ = child.wait();
        // Also cleans up the inert descendant if termination regresses.
        let mut cleanup = Command::new("taskkill");
        hidden(&mut cleanup);
        let leftover = cleanup.args(["/PID", &descendant.to_string(), "/T", "/F"])
            .stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap();
        assert!(result.is_ok());
        assert!(!leftover.success(), "Cancellation left a Python descendant running");
    }
}
