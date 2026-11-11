//! Optional, checksum-verified GPU plugins. The base executable never links CUDA.
use crate::{Cancel, Emit, check_cancel, engine::Decoded, models};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{
    ffi::{CStr, CString, c_char, c_void},
    path::{Component, Path},
    sync::Arc,
};
pub const ABI: &str = "aiditor-whisper-rs-0.16-tara-v1";
fn plugin_name() -> &'static str {
    if cfg!(windows) {
        "aiditor_speech.dll"
    } else if cfg!(target_os = "macos") {
        "libaiditor_speech.dylib"
    } else {
        "libaiditor_speech.so"
    }
}
pub fn auto_install(root: &Path, emit: &Emit, cancel: &Cancel) -> Result<Value> {
    let detected = hardware();
    let catalog: Value = serde_json::from_str(include_str!("../runtime-packs.json"))?;
    let mut choices = candidate_backends(&detected, "auto");
    choices.push("ct2-cpu");
    let mut warnings = Vec::new();
    for backend in choices {
        let platform = crate::hardware::platform();
        if let Some(manifest) = catalog["platforms"][&platform]
            .get(backend)
            .or_else(|| catalog["packs"].get(backend))
        {
            match install(root, manifest, emit, cancel) {
                Ok(()) => {
                    return Ok(
                        json!({"hardware":detected,"installed":backend,"warnings":warnings}),
                    );
                }
                Err(error) => {
                    check_cancel(cancel)?;
                    warnings.push(format!("{backend}: {error}"));
                }
            }
        }
    }
    Ok(
        json!({"hardware":detected,"installed":"cpu","warnings":warnings,"reason":"No compatible published GPU acceleration pack is available in the pinned catalog. CPU remains available."}),
    )
}
pub fn hardware() -> Value {
    crate::hardware::detect()
}
pub(crate) fn safe_relative(path: &str) -> bool {
    !path.is_empty()
        && !path.contains([':', '\\', '\0'])
        && Path::new(path)
            .components()
            .all(|p| matches!(p, Component::Normal(_)))
}
pub fn candidate_backends(hardware: &Value, requested: &str) -> Vec<&'static str> {
    match requested {
        "cpu" => vec![],
        "vulkan" => vec!["vulkan"],
        "metal" => vec!["metal"],
        "cuda" => vec!["cuda", "vulkan"],
        _ => {
            let mut result = vec![];
            if !hardware["nvidia"].is_null() {
                result.push("cuda");
            }
            if hardware["metal"] == true {
                result.push("metal");
            }
            if hardware["vulkanLoader"] == true {
                result.push("vulkan");
            }
            result
        }
    }
}
pub(crate) fn validate_manifest(manifest: &Value) -> Result<()> {
    let backend = manifest["backend"].as_str().context("Missing backend")?;
    let abi = if backend == "ct2-cpu" {
        crate::ct2::ABI
    } else {
        ABI
    };
    if manifest["abi"] != abi || !["cuda", "vulkan", "metal", "ct2-cpu"].contains(&backend) {
        bail!("Acceleration pack ABI/backend mismatch");
    }
    if let Some(platform) = manifest["platform"].as_str() {
        if platform != crate::hardware::platform() {
            bail!("Runtime pack targets another OS/architecture");
        }
    } else if !cfg!(all(windows, target_arch = "x86_64")) || backend == "ct2-cpu" {
        bail!("Runtime pack must declare its OS/architecture");
    }
    Ok(())
}
/// Explicit local import for release builders. Never downloads dependencies.
pub fn import(root: &Path, source: &Path, cancel: &Cancel) -> Result<()> {
    let manifest: Value =
        serde_json::from_reader(std::fs::File::open(source.join("manifest.json"))?)?;
    validate_manifest(&manifest)?;
    let directory = root
        .join("runtime")
        .join(manifest["backend"].as_str().unwrap());
    for file in manifest["files"].as_array().context("Missing pack files")? {
        check_cancel(cancel)?;
        let name = file["name"].as_str().context("Missing filename")?;
        if !safe_relative(name) {
            bail!("Unsafe runtime path");
        }
        if !models::verified(
            &source.join(name),
            file["size"].as_u64().unwrap_or(0),
            file["sha256"].as_str().unwrap_or(""),
        ) {
            bail!("Local runtime checksum mismatch: {name}");
        }
    }
    std::fs::create_dir_all(&directory)?;
    for file in manifest["files"].as_array().unwrap() {
        let name = file["name"].as_str().unwrap();
        let target = directory.join(name);
        std::fs::create_dir_all(target.parent().unwrap())?;
        let part = target.with_extension("import.part");
        std::fs::copy(source.join(name), &part)?;
        if !models::verified(
            &part,
            file["size"].as_u64().unwrap(),
            file["sha256"].as_str().unwrap(),
        ) {
            bail!("Runtime changed during import");
        }
        if target.exists() {
            std::fs::remove_file(&target)?;
        }
        std::fs::rename(part, target)?;
    }
    std::fs::write(
        directory.join("manifest.json"),
        serde_json::to_vec_pretty(&manifest)?,
    )?;
    Ok(())
}
pub fn install(root: &Path, manifest: &Value, emit: &Emit, cancel: &Cancel) -> Result<()> {
    validate_manifest(manifest)?;
    let backend = manifest["backend"].as_str().context("Missing backend")?;
    let directory = root.join("runtime").join(backend);
    let archive = if let Some(archive) = manifest.get("archive") {
        let path = root.join("runtime").join(format!("{backend}.zip"));
        models::download(
            &path,
            archive["url"].as_str().context("Missing archive URL")?,
            archive["size"].as_u64().context("Missing archive size")?,
            archive["sha256"].as_str().context("Missing archive hash")?,
            emit,
            cancel,
        )?;
        Some(path)
    } else {
        None
    };
    for entry in manifest["files"]
        .as_array()
        .context("Missing runtime files")?
    {
        let name = entry["name"].as_str().context("Missing runtime filename")?;
        if !safe_relative(name) {
            bail!("Unsafe runtime path")
        }
        let target = directory.join(name);
        let size = entry["size"].as_u64().context("Missing size")?;
        let sha = entry["sha256"].as_str().context("Missing hash")?;
        if let Some(path) = &archive {
            if models::verified(&target, size, sha) {
                continue;
            }
            check_cancel(cancel)?;
            let mut zip = zip::ZipArchive::new(std::fs::File::open(path)?)?;
            let mut file = zip.by_name(name)?;
            if file.size() != size {
                bail!("Runtime member size mismatch")
            }
            std::fs::create_dir_all(target.parent().unwrap())?;
            let temp = target.with_extension("extract.part");
            let mut output = std::fs::File::create(&temp)?;
            std::io::copy(&mut file, &mut output)?;
            drop(output);
            if !models::verified(&temp, size, sha) {
                bail!("Runtime member checksum mismatch")
            }
            if target.exists() {
                std::fs::remove_file(&target)?
            }
            std::fs::rename(temp, target)?;
        } else {
            models::download(
                &target,
                entry["url"].as_str().context("Missing URL")?,
                size,
                sha,
                emit,
                cancel,
            )?;
        }
    }
    std::fs::write(
        directory.join("manifest.json"),
        serde_json::to_vec_pretty(manifest)?,
    )?;
    Ok(())
}
pub fn try_gpu(
    root: &Path,
    samples: &[f32],
    request: &Value,
    emit: &Emit,
    cancel: &Cancel,
) -> Result<Option<Decoded>> {
    if request["device"] == "cpu" {
        return Ok(None);
    }
    let candidates = candidate_backends(&hardware(), request["device"].as_str().unwrap_or("auto"));
    for backend in candidates {
        let directory = root.join("runtime").join(backend);
        let manifest = directory.join("manifest.json");
        if !manifest.exists() {
            continue;
        }
        let attempt = (|| -> Result<Decoded> {
            let m: Value = serde_json::from_slice(&std::fs::read(manifest)?)?;
            validate_manifest(&m)?;
            if m["backend"] != backend {
                bail!("Plugin ABI/backend mismatch")
            }
            let files = m["files"].as_array().context("Missing files")?;
            let mut plugin = false;
            for entry in files {
                let name = entry["name"].as_str().context("Missing name")?;
                if !safe_relative(name) {
                    bail!("Unsafe plugin path")
                }
                if name == plugin_name() {
                    plugin = true
                }
                if !models::verified(
                    &directory.join(name),
                    entry["size"].as_u64().unwrap_or(0),
                    entry["sha256"].as_str().unwrap_or(""),
                ) {
                    bail!("Plugin checksum mismatch")
                }
            }
            if !plugin {
                bail!("Pack does not contain the native plugin for this OS")
            }
            check_cancel(cancel)?;
            #[cfg(windows)]
            let library: libloading::Library = unsafe {
                libloading::os::windows::Library::load_with_flags(
                    directory.join(plugin_name()),
                    0x00000100 | 0x00001000,
                )?
            }
            .into();
            #[cfg(not(windows))]
            let library = unsafe { libloading::Library::new(directory.join(plugin_name()))? };
            type Infer = unsafe extern "C" fn(
                *const c_char,
                *const c_char,
                *const f32,
                usize,
                extern "C" fn(*const c_char, *mut c_void),
                extern "C" fn(*mut c_void) -> bool,
                *mut c_void,
            ) -> *mut c_char;
            type Free = unsafe extern "C" fn(*mut c_char);
            let infer: libloading::Symbol<Infer> =
                unsafe { library.get(b"aiditor_transcribe_pcm_v1\0") }?;
            let free: libloading::Symbol<Free> = unsafe { library.get(b"aiditor_free_v1\0") }?;
            let root = CString::new(root.to_str().context("Invalid cache path")?)?;
            let request = CString::new(request.to_string())?;
            let mut callbacks = (emit.clone(), cancel.clone());
            extern "C" fn progress(value: *const c_char, user: *mut c_void) {
                let pair = unsafe { &*(user as *const (Emit, Cancel)) };
                if value.is_null() {
                    return;
                }
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                    if let Ok(event) =
                        serde_json::from_slice::<Value>(unsafe { CStr::from_ptr(value) }.to_bytes())
                    {
                        (pair.0)("progress", event);
                    }
                }));
            }
            extern "C" fn abort(user: *mut c_void) -> bool {
                unsafe { &*(user as *const (Emit, Cancel)) }
                    .1
                    .load(std::sync::atomic::Ordering::Relaxed)
            }
            let ptr = unsafe {
                infer(
                    root.as_ptr(),
                    request.as_ptr(),
                    samples.as_ptr(),
                    samples.len(),
                    progress,
                    abort,
                    (&mut callbacks as *mut (Emit, Cancel)).cast(),
                )
            };
            if ptr.is_null() {
                bail!("GPU plugin returned no result")
            }
            let payload = unsafe { CStr::from_ptr(ptr) }.to_bytes().to_vec();
            unsafe { free(ptr) };
            let value: Value = serde_json::from_slice(&payload)?;
            if let Some(error) = value.get("error") {
                bail!("GPU plugin: {error}")
            }
            let result: Decoded = serde_json::from_value(value)?;
            if result.device == "cpu" || result.native_profile["gpuModelBuffers"] != true {
                bail!("GPU backend did not confirm GPU-resident model buffers")
            }
            Ok(result)
        })();
        match attempt {
            Ok(value) => return Ok(Some(value)),
            Err(error) => {
                check_cancel(cancel)?;
                emit(
                    "progress",
                    json!({"stage":"fallback","message":format!("{backend} unavailable: {error}. Trying next backend.")}),
                );
            }
        }
    }
    Ok(None)
}
// Plugin builds export a narrow C ABI rather than sharing Rust object layouts.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aiditor_transcribe_pcm_v1(
    root: *const c_char,
    request: *const c_char,
    samples: *const f32,
    count: usize,
    progress: extern "C" fn(*const c_char, *mut c_void),
    abort: extern "C" fn(*mut c_void) -> bool,
    user: *mut c_void,
) -> *mut c_char {
    let result = std::panic::catch_unwind(|| -> Result<Decoded> {
        if root.is_null()
            || request.is_null()
            || samples.is_null()
            || count == 0
            || count > 16000 * 7200
        {
            bail!("Invalid plugin inputs")
        }
        let root = Path::new(unsafe { CStr::from_ptr(root) }.to_str()?);
        let request: Value = serde_json::from_str(unsafe { CStr::from_ptr(request) }.to_str()?)?;
        let samples = unsafe { std::slice::from_raw_parts(samples, count) };
        let user_address = user as usize;
        let emit: Emit = Arc::new(move |_, value| {
            if let Ok(event) = CString::new(value.to_string()) {
                progress(event.as_ptr(), user_address as *mut c_void);
            }
        });
        crate::engine::whisper_with_abort(
            root,
            samples,
            &request,
            &emit,
            Arc::new(move || abort(user_address as *mut c_void)),
        )
    });
    let payload = match result {
        Ok(Ok(value)) => serde_json::to_string(&value)
            .unwrap_or_else(|_| "{\"error\":\"Serialization failed\"}".into()),
        Ok(Err(e)) => json!({"error":e.to_string()}).to_string(),
        Err(_) => "{\"error\":\"GPU plugin panicked\"}".into(),
    };
    CString::new(payload).unwrap().into_raw()
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aiditor_free_v1(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(unsafe { CString::from_raw(ptr) });
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_uses_capability_and_requested_device() {
        let cpu = json!({"nvidia":null,"metal":false,"vulkanLoader":false});
        assert!(candidate_backends(&cpu, "auto").is_empty());
        let gpu = json!({"nvidia":"RTX","metal":false,"vulkanLoader":true});
        assert_eq!(candidate_backends(&gpu, "auto"), vec!["cuda", "vulkan"]);
        assert_eq!(candidate_backends(&gpu, "vulkan"), vec!["vulkan"]);
        assert!(candidate_backends(&gpu, "cpu").is_empty());
    }
    #[test]
    fn rejects_runtime_from_another_platform_before_loading() {
        let manifest = json!({"backend":"ct2-cpu","abi":crate::ct2::ABI,"platform":"unsupported-architecture"});
        assert!(validate_manifest(&manifest).is_err());
    }
    #[test]
    fn rejects_pack_traversal() {
        assert!(!safe_relative("../cuda.dll"));
        assert!(!safe_relative("C:\\cuda.dll"));
        assert!(safe_relative("cublas64_12.dll"));
    }
    #[test]
    fn missing_or_corrupt_gpu_pack_returns_to_cpu_without_loading() {
        let root = std::env::temp_dir().join(format!("aiditor-pack-{}", uuid::Uuid::new_v4()));
        let events = Arc::new(std::sync::Mutex::new(Vec::new()));
        let received = events.clone();
        let emit: Emit = Arc::new(move |_, event| received.lock().unwrap().push(event));
        let cancel = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let request = json!({"device":"cuda"});
        assert!(
            try_gpu(&root, &[0.], &request, &emit, &cancel)
                .unwrap()
                .is_none()
        );
        std::fs::create_dir_all(root.join("runtime/cuda")).unwrap();
        std::fs::write(root.join("runtime/cuda/manifest.json"), json!({"abi":ABI,"backend":"cuda","files":[{"name":"aiditor_speech.dll","size":1,"sha256":"bad"}]}).to_string()).unwrap();
        assert!(
            try_gpu(&root, &[0.], &request, &emit, &cancel)
                .unwrap()
                .is_none()
        );
        assert_eq!(events.lock().unwrap()[0]["stage"], "fallback");
        std::fs::remove_dir_all(root).unwrap();
    }
}
