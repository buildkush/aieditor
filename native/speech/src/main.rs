use aiditor_speech::{Emit, cache_root, models, run, server};
use anyhow::{Result, bail};
use serde_json::json;
use std::{
    path::PathBuf,
    sync::{Arc, atomic::AtomicBool},
};
fn main() {
    if let Err(error) = main_inner() {
        eprintln!("{error:#}");
        std::process::exit(1)
    }
}
fn main_inner() -> Result<()> {
    let args: Vec<_> = std::env::args().skip(1).collect();
    let root = cache_root()?;
    let emit: Emit = Arc::new(|kind, value| {
        if kind == "progress" {
            eprintln!("{}", value);
        }
    });
    let cancel = Arc::new(AtomicBool::new(false));
    let option = |name: &str, default: &str| {
        args.iter()
            .position(|v| v == name)
            .and_then(|i| args.get(i + 1))
            .cloned()
            .unwrap_or_else(|| default.into())
    };
    match args.first().map(String::as_str) {
        Some("hardware") => println!("{}", aiditor_speech::accelerator::hardware()),
        Some("runtime") if args.get(1).map(String::as_str) == Some("auto") => println!(
            "{}",
            aiditor_speech::accelerator::auto_install(&root, &emit, &cancel)?
        ),
        Some("runtime") => {
            if args.get(1).map(String::as_str) == Some("import") {
                let source = args.get(2).ok_or_else(|| {
                    anyhow::anyhow!("Usage: aiditor runtime import <pack-directory>")
                })?;
                aiditor_speech::accelerator::import(&root, &PathBuf::from(source), &cancel)?;
                return Ok(());
            }
            let manifest = args.get(2).ok_or_else(|| {
                anyhow::anyhow!("Usage: aiditor runtime install <verified-release-manifest.json>")
            })?;
            if args.get(1).map(String::as_str) != Some("install") {
                bail!("Use runtime install")
            }
            aiditor_speech::accelerator::install(
                &root,
                &serde_json::from_slice(&std::fs::read(manifest)?)?,
                &emit,
                &cancel,
            )?;
        }
        Some("transcribe") => {
            let path = args.get(1).filter(|p| !p.starts_with('-')).ok_or_else(|| {
                anyhow::anyhow!(
                    "Usage: aiditor transcribe <file> --model tara|shruti --output-format json"
                )
            })?;
            if option("--output-format", "json") != "json" {
                bail!("Only JSON output is supported")
            }
            let mut request = json!({"action":"transcribe","path":PathBuf::from(path),"model":option("--model","tara"),"language":option("--language","hi"),"device":option("--device","auto"),"engine":option("--engine","auto")});
            if args.iter().any(|arg| arg.starts_with("--diagnostic-")) {
                let mut diagnostics = json!({});
                if args.iter().any(|a| a == "--diagnostic-threads") {
                    diagnostics["threads"] =
                        json!(option("--diagnostic-threads", "").parse::<u32>()?);
                }
                if args.iter().any(|a| a == "--diagnostic-alignment") {
                    diagnostics["alignment"] =
                        json!(option("--diagnostic-alignment", "").parse::<bool>()?);
                }
                if args.iter().any(|a| a == "--diagnostic-fallback") {
                    diagnostics["temperatureFallback"] =
                        json!(option("--diagnostic-fallback", "").parse::<bool>()?);
                }
                request["diagnostics"] = diagnostics;
            }
            let result = run(&root, request, emit, cancel)?;
            println!("{}", serde_json::to_string(&result)?);
        }
        Some("models") => {
            let model = args.get(2).map(String::as_str).unwrap_or("tara");
            match args.get(1).map(String::as_str) {
                Some("convert")
                    if model == "tara" && option("--engine", "auto") == "ctranslate2" =>
                {
                    let source = option("--source", "");
                    if source.is_empty() {
                        bail!(
                            "models convert tara --engine ctranslate2 --source <verified-original-checkpoint>"
                        );
                    }
                    aiditor_speech::ct2_convert::convert(
                        &PathBuf::from(source),
                        &aiditor_speech::ct2::model_path(&root),
                        &emit,
                        &cancel,
                    )?;
                    aiditor_speech::vad::install(&root, &emit, &cancel)?;
                }
                Some("install")
                    if model == "tara" && option("--engine", "auto") == "ctranslate2" =>
                {
                    aiditor_speech::ct2::model_marker(&root,true).map_err(|_|anyhow::anyhow!("No verified CT2 Tara artifact is installed. Release builders: use models convert tara --engine ctranslate2 --source <checkpoint>. A preconverted download must be published before end-user setup can install this backend."))?;
                    aiditor_speech::vad::install(&root, &emit, &cancel)?;
                }
                Some("install") => models::install(&root, model, &emit, &cancel)?,
                Some("status") => println!("{}", models::status(&root, model)?),
                Some("verify")
                    if model == "tara"
                        && (option("--engine", "auto") == "ctranslate2"
                            || (option("--engine", "auto") == "auto"
                                && aiditor_speech::ct2::pack_ready(&root)
                                && aiditor_speech::ct2::model_marker(&root, false).is_ok())) =>
                {
                    println!("{}", aiditor_speech::ct2::verify(&root, &emit, &cancel)?);
                }
                Some("verify") if ["tara", "tara-q5_0"].contains(&model) => {
                    println!("{}", models::verify_tara(&root, model)?)
                }
                _ => bail!(
                    "Usage: aiditor models install|status tara|tara-q5_0|shruti; models verify tara"
                ),
            }
        }
        Some("mcp") => server::mcp(root)?,
        Some("serve") => server::http(
            root,
            option("--port", "49823").parse()?,
            &std::env::var("AIDITOR_HTTP_TOKEN").unwrap_or_default(),
        )?,
        _ => {
            bail!("Usage: aiditor transcribe <file> | models install|status <model> | mcp | serve")
        }
    }
    Ok(())
}
