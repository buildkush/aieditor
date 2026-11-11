//! Loopback job API and JSON-RPC MCP. Long inference never blocks a tool request.
use crate::{Cancel, Emit, run};
use anyhow::{Result, bail};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::BufRead,
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
struct Job {
    result: Arc<Mutex<Value>>,
    cancel: Cancel,
}
pub struct Jobs {
    root: PathBuf,
    jobs: Mutex<HashMap<String, Job>>,
}
impl Jobs {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            jobs: Mutex::new(HashMap::new()),
        }
    }
    pub fn call(&self, name: &str, args: Value) -> Result<Value> {
        match name {
            "transcribe_start" => {
                if !args.is_object() {
                    bail!("Tool arguments must be an object")
                }
                let mut jobs = self.jobs.lock().unwrap();
                if jobs.len() >= 32 {
                    bail!("Job limit reached; release completed jobs")
                }
                if jobs
                    .values()
                    .any(|job| job.result.lock().unwrap()["state"] == "running")
                {
                    bail!("A transcription job is already running")
                }
                let id = uuid::Uuid::new_v4().to_string();
                if args["path"].as_str().is_none_or(str::is_empty) {
                    bail!("A nonempty input path is required")
                }
                let result = Arc::new(Mutex::new(json!({"state":"running"})));
                let cancel = Arc::new(AtomicBool::new(false));
                let (root, state, abort) = (self.root.clone(), result.clone(), cancel.clone());
                let emit: Emit = Arc::new(move |kind, value| {
                    if kind == "progress" {
                        *state.lock().unwrap() = json!({"state":"running","progress":value});
                    }
                });
                let state = result.clone();
                std::thread::spawn(move || {
                    let mut request = args;
                    request["action"] = json!("transcribe");
                    let output = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        run(&root, request, emit, abort.clone())
                    }))
                    .unwrap_or_else(|_| {
                        Err(anyhow::anyhow!("Native transcription worker panicked"))
                    });
                    *state.lock().unwrap() = match output {
                        Ok(value) => json!({"state":"complete","result":value}),
                        Err(error) => {
                            json!({"state":if abort.load(Ordering::Relaxed){"cancelled"}else{"error"},"error":error.to_string()})
                        }
                    };
                });
                jobs.insert(id.clone(), Job { result, cancel });
                Ok(json!({"jobId":id}))
            }
            "transcribe_status" | "transcribe_cancel" | "transcribe_release" => {
                let mut jobs = self.jobs.lock().unwrap();
                let id = args["jobId"]
                    .as_str()
                    .ok_or_else(|| anyhow::anyhow!("Missing jobId"))?;
                let job = jobs.get(id).ok_or_else(|| anyhow::anyhow!("Unknown job"))?;
                if name == "transcribe_cancel" {
                    job.cancel.store(true, Ordering::Relaxed);
                    return Ok(json!({"cancellationRequested":true}));
                }
                let result = job.result.lock().unwrap().clone();
                if name == "transcribe_release" {
                    if result["state"] == "running" {
                        bail!("Cancel and wait before releasing a running job")
                    }
                    jobs.remove(id);
                }
                Ok(result)
            }
            _ => bail!("Unknown tool"),
        }
    }
    fn rpc(&self, request: Value) -> Value {
        let id = request["id"].clone();
        let value = match request["method"].as_str() {
            Some("initialize") => Ok(
                json!({"protocolVersion":"2024-11-05","capabilities":{"tools":{}},"serverInfo":{"name":"aiditor-native-speech","version":"0.1.0"}}),
            ),
            Some("tools/list") => Ok(json!({"tools":[
            {"name":"transcribe_start","description":"Start read-only transcription; returns a job ID immediately. Does not edit a project.","inputSchema":{"type":"object","properties":{"path":{"type":"string"},"model":{"enum":["tara","tara-q5_0","shruti"]},"language":{"enum":["hi","en","auto"]},"device":{"enum":["auto","cpu","cuda","vulkan","metal"]},"engine":{"enum":["auto","whisper-cpp","ctranslate2"]}},"required":["path"]}},
            {"name":"transcribe_status","description":"Poll a transcription job.","inputSchema":{"type":"object","properties":{"jobId":{"type":"string"}},"required":["jobId"]}},
            {"name":"transcribe_cancel","description":"Cancel a transcription job.","inputSchema":{"type":"object","properties":{"jobId":{"type":"string"}},"required":["jobId"]}},
            {"name":"transcribe_release","description":"Release a completed job.","inputSchema":{"type":"object","properties":{"jobId":{"type":"string"}},"required":["jobId"]}}]})),
            Some("tools/call") => self
                .call(
                    request["params"]["name"].as_str().unwrap_or(""),
                    request["params"]["arguments"].clone(),
                )
                .map(|v| json!({"content":[{"type":"text","text":v.to_string()}]})),
            Some("ping") => Ok(json!({})),
            _ => Err(anyhow::anyhow!("Method not found")),
        };
        match value {
            Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
            Err(error) => {
                json!({"jsonrpc":"2.0","id":id,"error":{"code":-32602,"message":error.to_string()}})
            }
        }
    }
}
pub fn mcp(root: PathBuf) -> Result<()> {
    let jobs = Jobs::new(root);
    for line in std::io::stdin().lock().lines() {
        let request: Value = match serde_json::from_str(&line?) {
            Ok(value) => value,
            Err(_) => {
                println!(
                    "{}",
                    json!({"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error"}})
                );
                continue;
            }
        };
        if request.get("id").is_some() {
            println!("{}", jobs.rpc(request));
        }
    }
    Ok(())
}
pub fn http(root: PathBuf, port: u16, token: &str) -> Result<()> {
    if token.len() < 24 {
        bail!("Set AIDITOR_HTTP_TOKEN to a random token of at least 24 characters")
    }
    let server =
        tiny_http::Server::http(("127.0.0.1", port)).map_err(|e| anyhow::anyhow!(e.to_string()))?;
    let jobs = Jobs::new(root);
    for mut request in server.incoming_requests() {
        let authenticated = request.headers().iter().any(|h| {
            h.field.equiv("Authorization") && h.value.as_str() == format!("Bearer {token}")
        });
        let origin = request.headers().iter().any(|h| h.field.equiv("Origin"));
        if !authenticated || origin {
            let _ = request
                .respond(tiny_http::Response::from_string("Unauthorized").with_status_code(401));
            continue;
        }
        let mut bytes = Vec::new();
        use std::io::Read;
        request.as_reader().take(65537).read_to_end(&mut bytes)?;
        let response = if bytes.len() > 65536 {
            json!({"error":"Request too large"})
        } else {
            match serde_json::from_slice::<Value>(&bytes) {
                Ok(value) => jobs.rpc(value),
                Err(error) => json!({"error":error.to_string()}),
            }
        };
        let _ = request.respond(
            tiny_http::Response::from_string(response.to_string()).with_header(
                tiny_http::Header::from_bytes("Content-Type", "application/json").unwrap(),
            ),
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tools_reject_invalid_inputs_and_project_mutations() {
        let jobs = Jobs::new(std::env::temp_dir());
        assert!(jobs.call("transcribe_start", json!({})).is_err());
        assert!(jobs.call("transcribe_start", json!([])).is_err());
        assert!(
            jobs.call("transcribe_status", json!({"jobId":"missing"}))
                .is_err()
        );
        assert!(jobs.call("apply_caption_track", json!({})).is_err());
    }
    #[test]
    fn running_jobs_can_be_cancelled_but_only_terminal_jobs_released() {
        let jobs = Jobs::new(std::env::temp_dir());
        let cancel = Arc::new(AtomicBool::new(false));
        let result = Arc::new(Mutex::new(json!({"state":"running"})));
        jobs.jobs.lock().unwrap().insert(
            "test".into(),
            Job {
                cancel: cancel.clone(),
                result: result.clone(),
            },
        );
        assert!(
            jobs.call("transcribe_release", json!({"jobId":"test"}))
                .is_err()
        );
        assert!(
            jobs.call("transcribe_start", json!({"path":"file"}))
                .is_err()
        );
        jobs.call("transcribe_cancel", json!({"jobId":"test"}))
            .unwrap();
        assert!(cancel.load(Ordering::Relaxed));
        *result.lock().unwrap() = json!({"state":"cancelled"});
        jobs.call("transcribe_release", json!({"jobId":"test"}))
            .unwrap();
        assert!(jobs.jobs.lock().unwrap().is_empty());
    }
}
