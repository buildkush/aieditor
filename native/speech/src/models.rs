use crate::{Cancel, Emit, audio::digest, check_cancel};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::Duration,
};
pub fn tara_path(root: &Path) -> PathBuf {
    root.join("models/ggml-tara-q8_0.bin")
}
pub fn shruti_library() -> &'static str {
    if cfg!(windows) {
        "libneedle3.dll"
    } else if cfg!(target_os = "macos") {
        "libneedle3.dylib"
    } else {
        "libneedle3.so"
    }
}
fn shruti_platform() -> &'static str {
    if cfg!(all(windows, target_arch = "x86_64")) {
        "win_amd64"
    } else if cfg!(all(windows, target_arch = "aarch64")) {
        "win_arm64"
    } else if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "macosx_11_0_arm64"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "macosx_11_0_x86_64"
    } else if cfg!(all(target_os = "linux", target_arch = "aarch64")) {
        "manylinux2014_aarch64"
    } else if cfg!(all(target_os = "linux", target_arch = "x86_64")) {
        "manylinux2014_x86_64"
    } else {
        "unsupported"
    }
}
pub fn verified(path: &Path, size: u64, sha: &str) -> bool {
    path.is_file()
        && fs::metadata(path).is_ok_and(|m| m.len() == size)
        && digest(path).is_ok_and(|h| h == sha)
}
pub fn download(
    path: &Path,
    url: &str,
    size: u64,
    sha: &str,
    emit: &Emit,
    cancel: &Cancel,
) -> Result<()> {
    check_cancel(cancel)?;
    if verified(path, size, sha) {
        return Ok(());
    }
    if !url.starts_with("https://") || sha.len() != 64 {
        bail!("Downloads require HTTPS and a pinned SHA256")
    }
    fs::create_dir_all(path.parent().unwrap())?;
    let part = path.with_extension("download.part");
    let mut response = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(7200))
        .build()?
        .get(url)
        .send()?
        .error_for_status()?;
    let mut file = File::create(&part)?;
    let mut buffer = vec![0; 1024 * 1024];
    let mut received = 0u64;
    loop {
        check_cancel(cancel)?;
        let n = response.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        received += n as u64;
        if received > size {
            bail!("Download exceeds pinned size")
        }
        file.write_all(&buffer[..n])?;
        emit(
            "progress",
            json!({"stage":"download","message":path.file_name().unwrap().to_string_lossy(),"completed":received,"total":size}),
        );
    }
    file.sync_all()?;
    drop(file);
    if !verified(&part, size, sha) {
        bail!("Download checksum/size mismatch: {}", path.display())
    }
    if path.exists() {
        fs::remove_file(path)?
    }
    fs::rename(part, path)?;
    Ok(())
}
pub(crate) fn verified_tara_hash(path: &Path, expected: &str) -> Result<bool> {
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    type Stamp = (
        u64,
        Option<std::time::SystemTime>,
        Option<std::time::SystemTime>,
        String,
    );
    static VERIFIED: OnceLock<Mutex<HashMap<PathBuf, Stamp>>> = OnceLock::new();
    let cache = VERIFIED.get_or_init(|| Mutex::new(HashMap::new()));
    let metadata = fs::metadata(path)?;
    let stamp = (
        metadata.len(),
        metadata.modified().ok(),
        metadata.created().ok(),
        expected.to_owned(),
    );
    if cache.lock().unwrap().get(path) == Some(&stamp) {
        return Ok(true);
    }
    if digest(path)? != expected {
        return Ok(false);
    }
    let after = fs::metadata(path)?;
    if (after.len(), after.modified().ok(), after.created().ok()) != (stamp.0, stamp.1, stamp.2) {
        bail!("Model changed during verification")
    }
    cache.lock().unwrap().insert(path.to_owned(), stamp);
    Ok(true)
}
pub fn tara_marker(path: &Path, hash: bool) -> Result<Value> {
    let marker: Value = serde_json::from_reader(File::open(path.with_extension("json"))?)?;
    if marker["format"] != "aiditor-tara-ggml-v1"
        || marker["mixedcodeToken"] != 51866
        || marker["nMels"] != 128
        || marker["size"].as_u64() != Some(fs::metadata(path)?.len())
        || (hash && !verified_tara_hash(path, marker["sha256"].as_str().unwrap_or(""))?)
    {
        bail!("Tara GGML model failed verification")
    }
    Ok(marker)
}
pub fn status(root: &Path, model: &str) -> Result<Value> {
    if !["tara", "tara-q5_0", "shruti"].contains(&model) {
        bail!("Unsupported model")
    }
    let (ready, name, path, repo) = if model == "tara"
        && crate::ct2::pack_ready(root)
        && crate::ct2::model_marker(root, false).is_ok()
    {
        (
            true,
            "Tara native INT8",
            crate::ct2::model_path(root).join("model.bin"),
            "Trelis/tara",
        )
    } else if model.starts_with("tara") {
        let path = if model == "tara-q5_0" {
            root.join("models/ggml-tara-q5_0.bin")
        } else {
            tara_path(root)
        };
        (
            tara_marker(&path, false).is_ok(),
            "Tara GGML",
            path,
            "Trelis/tara",
        )
    } else {
        let path = root.join("models/shruti/shruti.cact");
        let assets: Value = serde_json::from_str(include_str!("../assets/shruti.json"))?;
        let lib = root.join("models/shruti").join(shruti_library());
        let info = &assets["platforms"][shruti_platform()];
        (
            verified(
                &path,
                assets["modelSize"].as_u64().unwrap(),
                assets["modelSha256"].as_str().unwrap(),
            ) && verified(
                &lib,
                info["librarySize"].as_u64().unwrap_or(0),
                info["librarySha256"].as_str().unwrap_or(""),
            ),
            "Shruti native",
            path,
            "udgamlabs/Shruti",
        )
    };
    Ok(
        json!({"id":model,"name":name,"repo":repo,"installed":ready,"runtimeInstalled":true,"totalBytes":fs::metadata(path).ok().map(|m|m.len()),"partialBytes":0,"error":null}),
    )
}
pub fn install(root: &Path, model: &str, emit: &Emit, cancel: &Cancel) -> Result<()> {
    if model == "tara"
        && crate::ct2::pack_ready(root)
        && crate::ct2::model_marker(root, true).is_ok()
    {
        return crate::vad::install(root, emit, cancel);
    }
    if model == "tara" || model == "tara-q5_0" {
        let q5 = model == "tara-q5_0";
        let target = root.join(if q5 {
            "models/ggml-tara-q5_0.bin"
        } else {
            "models/ggml-tara-q8_0.bin"
        });
        if tara_marker(&target, true).is_ok() {
            return Ok(());
        }
        let source = root.join("models/tara");
        let assets: Value = serde_json::from_str(include_str!("../assets/tara-source.json"))?;
        for file in assets["files"]
            .as_array()
            .context("Missing pinned Tara assets")?
        {
            let name = file["name"].as_str().unwrap();
            let url = format!(
                "https://huggingface.co/{}/resolve/{}/{}",
                assets["repo"].as_str().unwrap_or("Trelis/tara"),
                assets["revision"].as_str().unwrap(),
                name
            );
            download(
                &source.join(name),
                &url,
                file["size"].as_u64().unwrap(),
                file["sha256"].as_str().unwrap(),
                emit,
                cancel,
            )?;
        }
        crate::convert::tara(&source, &target, q5, emit, cancel)?;
    } else if model == "shruti" {
        let a: Value = serde_json::from_str(include_str!("../assets/shruti.json"))?;
        let p = &a["platforms"][shruti_platform()];
        if p.is_null() {
            bail!("No pinned Shruti runtime exists for this OS/architecture")
        }
        let folder = root.join("models/shruti");
        download(
            &folder.join("shruti.cact"),
            &format!(
                "https://huggingface.co/{}/resolve/{}/shruti.cact",
                a["modelRepo"].as_str().unwrap(),
                a["modelRevision"].as_str().unwrap()
            ),
            a["modelSize"].as_u64().unwrap(),
            a["modelSha256"].as_str().unwrap(),
            emit,
            cancel,
        )?;
        let library = folder.join(shruti_library());
        if !verified(
            &library,
            p["librarySize"].as_u64().unwrap(),
            p["librarySha256"].as_str().unwrap(),
        ) {
            let archive = folder.join("needle-runtime.zip");
            download(
                &archive,
                &format!(
                    "https://huggingface.co/{}/resolve/{}/{}",
                    a["engineRepo"].as_str().unwrap(),
                    a["engineRevision"].as_str().unwrap(),
                    p["path"].as_str().unwrap()
                ),
                p["size"].as_u64().unwrap(),
                p["sha256"].as_str().unwrap(),
                emit,
                cancel,
            )?;
            let mut zip = zip::ZipArchive::new(File::open(archive)?)?;
            let mut file = zip.by_name(&format!("needle/{}", shruti_library()))?;
            let part = library.with_extension("extract.part");
            let mut output = File::create(&part)?;
            std::io::copy(&mut file, &mut output)?;
            drop(output);
            if !verified(
                &part,
                p["librarySize"].as_u64().unwrap(),
                p["librarySha256"].as_str().unwrap(),
            ) {
                bail!("Needle DLL failed verification")
            }
            if library.exists() {
                fs::remove_file(&library)?
            }
            fs::rename(part, library)?;
        }
    } else {
        bail!("Unsupported model")
    }
    Ok(())
}
pub fn verify_tara(root: &Path, model: &str) -> Result<Value> {
    let path = if model == "tara-q5_0" {
        root.join("models/ggml-tara-q5_0.bin")
    } else {
        tara_path(root)
    };
    tara_marker(&path, true)?;
    let mut parameters = whisper_rs::WhisperContextParameters::default();
    parameters.use_gpu = false;
    let context = whisper_rs::WhisperContext::new_with_params(
        path.to_str().context("Invalid path")?,
        parameters,
    )?;
    if context.model_n_mels() != 128
        || context.token_to_bytes(51866)? != b"<|mixedcode|>"
        || context.token_sot() != 50258
        || context.token_not() != 50364
        || context.model_n_vocab() != 51904
        || context.model_n_audio_layer() != 32
        || context.model_n_text_layer() != 32
    {
        bail!("Converted model architecture mismatch")
    }
    Ok(
        json!({"loaded":true,"nVocab":context.model_n_vocab(),"mixedcodeToken":51866,"mixedcodeText":context.token_to_str(51866)?,"nMels":context.model_n_mels(),"inferencePerformed":false}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn changed_model_invalidates_cached_verification() {
        let root = std::env::temp_dir().join(format!("aiditor-hash-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let file = root.join("model.bin");
        fs::write(&file, b"verified model").unwrap();
        let expected = digest(&file).unwrap();
        assert!(verified_tara_hash(&file, &expected).unwrap());
        assert!(verified_tara_hash(&file, &expected).unwrap());
        fs::write(&file, b"changed model with a different length").unwrap();
        assert!(!verified_tara_hash(&file, &expected).unwrap());
        assert!(verified_tara_hash(&file, &digest(&file).unwrap()).unwrap());
        fs::remove_dir_all(root).unwrap();
    }
}
