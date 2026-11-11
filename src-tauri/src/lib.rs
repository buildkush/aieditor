use serde::{Deserialize, Serialize};
mod speech_lab;

#[tauri::command]
fn get_default_project_dir() -> String {
    if let Ok(profile) = std::env::var("USERPROFILE") {
        format!("{}\\Videos\\Aiditor Projects", profile)
    } else if let Ok(home) = std::env::var("HOME") {
        format!("{}/Movies/Aiditor Projects", home)
    } else {
        "C:\\Aiditor Projects".to_string()
    }
}

#[tauri::command]
fn pick_project_folder() -> Option<String> {
    let default_path = get_default_project_dir();
    let mut dialog = rfd::FileDialog::new().set_title("Select Project Folder");
    if std::path::Path::new(&default_path).exists() {
        dialog = dialog.set_directory(&default_path);
    }
    let folder = dialog.pick_folder();
    folder.map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_project_file() -> Option<String> {
    let default_path = get_default_project_dir();
    let mut dialog = rfd::FileDialog::new()
        .set_title("Open Aiditor Project")
        .add_filter("Aiditor Project (*.aiditor)", &["aiditor"])
        .add_filter("All Files (*.*)", &["*"]);
    if std::path::Path::new(&default_path).exists() {
        dialog = dialog.set_directory(&default_path);
    }
    let file = dialog.pick_file();
    file.map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_save_project_file(
    default_name: Option<String>,
    default_dir: Option<String>,
) -> Option<String> {
    let dir = default_dir.unwrap_or_else(get_default_project_dir);
    let mut dialog = rfd::FileDialog::new()
        .set_title("Save Aiditor Project")
        .add_filter("Aiditor Project (*.aiditor)", &["aiditor"]);
    if std::path::Path::new(&dir).exists() {
        dialog = dialog.set_directory(&dir);
    }
    if let Some(name) = default_name {
        let file_name = if name.ends_with(".aiditor") {
            name
        } else {
            format!("{}.aiditor", name)
        };
        dialog = dialog.set_file_name(&file_name);
    }
    let file = dialog.save_file();
    file.map(|p| p.to_string_lossy().to_string())
}

#[tauri::command]
fn pick_media_files() -> Vec<String> {
    let dialog = rfd::FileDialog::new()
        .set_title("Import Media Files")
        .add_filter(
            "Supported Media (*.mp4, *.mov, *.webm, *.mp3, *.wav, *.png, *.jpg, *.srt, *.vtt...)",
            &[
                "mp4", "mov", "mkv", "webm", "avi", "m4v", "mp3", "wav", "aac", "m4a", "flac",
                "ogg", "png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "wbmp", "wbpm", "srt",
                "vtt",
            ],
        )
        .add_filter("Subtitle Files (*.srt, *.vtt)", &["srt", "vtt"])
        .add_filter("Video Files", &["mp4", "mov", "mkv", "webm", "avi", "m4v"])
        .add_filter("Audio Files", &["mp3", "wav", "aac", "m4a", "flac", "ogg"])
        .add_filter(
            "Image Files",
            &[
                "png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "wbmp", "wbpm",
            ],
        )
        .add_filter("All Files (*.*)", &["*"]);

    if let Some(files) = dialog.pick_files() {
        files
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect()
    } else {
        Vec::new()
    }
}

#[tauri::command]
async fn export_caption_file(
    default_name: String,
    srt: String,
    vtt: String,
) -> Result<Option<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let selected = rfd::FileDialog::new()
            .set_title("Export Captions")
            .add_filter("SubRip captions (*.srt)", &["srt"])
            .add_filter("WebVTT captions (*.vtt)", &["vtt"])
            .set_file_name(&default_name)
            .save_file();
        let Some(mut path) = selected else {
            return Ok(None);
        };
        if path.extension().is_none() {
            path.set_extension("srt");
        }
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let content = match extension.as_str() {
            "srt" => srt,
            "vtt" => vtt,
            _ => return Err("Choose an .srt or .vtt filename for caption export.".to_string()),
        };
        std::fs::write(&path, content)
            .map_err(|error| format!("Could not write captions: {}", error))?;
        Ok(Some(path.to_string_lossy().to_string()))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
fn pick_subtitle_files() -> Vec<String> {
    let dialog = rfd::FileDialog::new()
        .set_title("Import Subtitle Files (.srt, .vtt)")
        .add_filter("Subtitle Files (*.srt, *.vtt)", &["srt", "vtt"])
        .add_filter("All Files (*.*)", &["*"]);

    if let Some(files) = dialog.pick_files() {
        files
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect()
    } else {
        Vec::new()
    }
}

#[tauri::command]
fn save_project_file(path: String, content: String) -> Result<(), String> {
    let path_buf = std::path::PathBuf::from(&path);
    if let Some(parent) = path_buf.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(&path_buf, content).map_err(|e| format!("Failed to write project file: {}", e))
}

#[tauri::command]
fn read_project_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read project file: {}", e))
}

#[tauri::command]
fn check_file_exists(path: String) -> bool {
    std::path::Path::new(&path).exists()
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct RecentProjectEntry {
    pub path: String,
    pub name: String,
    pub last_opened: String,
}

fn get_recent_projects_path() -> std::path::PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        std::path::PathBuf::from(appdata)
            .join("aiditor")
            .join("recent_projects.json")
    } else if let Ok(home) = std::env::var("HOME") {
        std::path::PathBuf::from(home)
            .join(".config")
            .join("aiditor")
            .join("recent_projects.json")
    } else {
        std::path::PathBuf::from("recent_projects.json")
    }
}

#[tauri::command]
fn get_recent_projects() -> Vec<RecentProjectEntry> {
    let path = get_recent_projects_path();
    if let Ok(content) = std::fs::read_to_string(&path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        Vec::new()
    }
}

#[tauri::command]
fn add_recent_project(
    path: String,
    name: String,
    last_opened: String,
) -> Result<Vec<RecentProjectEntry>, String> {
    let file_path = get_recent_projects_path();
    if let Some(parent) = file_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let mut recents = get_recent_projects();
    recents.retain(|r| r.path != path);
    recents.insert(
        0,
        RecentProjectEntry {
            path,
            name,
            last_opened,
        },
    );
    recents.truncate(20);
    if let Ok(json) = serde_json::to_string_pretty(&recents) {
        let _ = std::fs::write(&file_path, json);
    }
    Ok(recents)
}

#[tauri::command]
fn clear_recent_projects() -> Result<(), String> {
    let file_path = get_recent_projects_path();
    if file_path.exists() {
        let _ = std::fs::remove_file(&file_path);
    }
    Ok(())
}

#[tauri::command]
fn app_minimize_window(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

#[tauri::command]
fn app_toggle_maximize_window(window: tauri::Window) -> Result<bool, String> {
    let is_max = window.is_maximized().map_err(|e| e.to_string())?;
    if is_max {
        window.unmaximize().map_err(|e| e.to_string())?;
        Ok(false)
    } else {
        window.maximize().map_err(|e| e.to_string())?;
        Ok(true)
    }
}

#[tauri::command]
fn app_close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
fn app_is_maximized(window: tauri::Window) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(speech_lab::SpeechJobs::default())
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                use tauri::Manager;
                speech_lab::shutdown(&window.state::<speech_lab::SpeechJobs>());
            }
        })
        .invoke_handler(tauri::generate_handler![
            speech_lab::speech_lab_environment,
            speech_lab::speech_lab_start,
            speech_lab::speech_lab_cancel,
            speech_lab::auto_captions_start,
            speech_lab::auto_captions_cancel,
            speech_lab::speech_lab_pick,
            speech_lab::speech_lab_import_chunk,
            speech_lab::speech_lab_export,
            get_default_project_dir,
            pick_project_folder,
            pick_project_file,
            pick_save_project_file,
            pick_media_files,
            pick_subtitle_files,
            export_caption_file,
            save_project_file,
            read_project_file,
            check_file_exists,
            get_recent_projects,
            add_recent_project,
            clear_recent_projects,
            app_minimize_window,
            app_toggle_maximize_window,
            app_close_window,
            app_is_maximized
        ])
        .setup(|app| {
            use tauri::Manager;
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
