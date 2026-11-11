//! Opt-in recognition check. Never selects recordings implicitly.
use aiditor_speech::{Emit, cache_root, engine, validate_words};
use serde_json::json;
use std::sync::{Arc, Mutex, atomic::AtomicBool};

fn recognize(model: &str) {
    let path = std::env::var("AIDITOR_CAPTION_TEST_PCM")
        .expect("Set an explicit 16 kHz mono f32le fixture path");
    let bytes = std::fs::read(path).unwrap();
    assert_eq!(bytes.len() % 4, 0);
    let samples: Vec<f32> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
        .collect();
    assert!(!samples.is_empty() && samples.iter().all(|s| s.is_finite()));
    let partials = Arc::new(Mutex::new(Vec::new()));
    let received = partials.clone();
    let emit: Emit = Arc::new(move |_, event| {
        if event["stage"] == "partial" {
            received.lock().unwrap().push(event);
        }
    });
    let cancel = Arc::new(AtomicBool::new(false));
    let result = engine::transcribe(
        &cache_root().unwrap(),
        model,
        &samples,
        &json!({"model":model,"language":"en","device":"cpu"}),
        &emit,
        &cancel,
    )
    .unwrap();
    validate_words(&result.words, samples.len() as f64 / 16000.).unwrap();
    assert!(!result.words.is_empty());
    assert!(result.words.iter().any(|w| w.end_time > w.start_time));
    assert!(result.text.to_lowercase().contains("hello"));
    if model.starts_with("tara") {
        assert!(partials.lock().unwrap().iter().any(|p| {
            p["partialSegment"]["words"]
                .as_array()
                .is_some_and(|words| !words.is_empty())
        }));
    }
    eprintln!(
        "{}",
        json!({"model":model,"text":result.text,"words":result.words,"inferenceSec":result.inference_sec,"modelLoadSec":result.load_sec})
    );
}
#[test]
#[ignore = "requires installed model and explicit synthetic 'hello' PCM fixture"]
fn tara_fixture() {
    recognize(&std::env::var("AIDITOR_CAPTION_TEST_MODEL").unwrap_or_else(|_| "tara-q5_0".into()));
}
#[test]
#[ignore = "requires installed model and explicit synthetic 'hello' PCM fixture"]
fn shruti_fixture() {
    recognize("shruti");
}
