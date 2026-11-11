//! Pinned Tara safetensors -> CT2 v6 / WhisperSpec v3, without Python.
//! Matches the old float16 intermediate and per-output-row INT8 quantization.
use crate::{Cancel, Emit, check_cancel};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{BufWriter, Write},
    path::Path,
};

enum Recipe {
    Tensor(Vec<String>, bool),
    Scalar(Vec<u8>, u8),
}
fn string(out: &mut impl Write, text: &str) -> Result<()> {
    let length = u16::try_from(text.len() + 1)?;
    out.write_all(&length.to_le_bytes())?;
    out.write_all(text.as_bytes())?;
    out.write_all(&[0])?;
    Ok(())
}
fn variable(
    out: &mut impl Write,
    name: &str,
    shape: &[usize],
    dtype: u8,
    bytes: &[u8],
) -> Result<()> {
    string(out, name)?;
    out.write_all(&[u8::try_from(shape.len())?])?;
    for &d in shape {
        out.write_all(&u32::try_from(d)?.to_le_bytes())?;
    }
    out.write_all(&[dtype])?;
    out.write_all(&u32::try_from(bytes.len())?.to_le_bytes())?;
    out.write_all(bytes)?;
    Ok(())
}
fn values(tensor: safetensors::tensor::TensorView<'_>) -> Result<Vec<f32>> {
    let mut result = vec![];
    match tensor.dtype() {
        safetensors::Dtype::BF16 => {
            for b in tensor.data().chunks_exact(2) {
                result.push(half::bf16::from_le_bytes(b.try_into()?).to_f32());
            }
        }
        safetensors::Dtype::F16 => {
            for b in tensor.data().chunks_exact(2) {
                result.push(half::f16::from_le_bytes(b.try_into()?).to_f32());
            }
        }
        safetensors::Dtype::F32 => {
            for b in tensor.data().chunks_exact(4) {
                result.push(f32::from_le_bytes(b.try_into()?));
            }
        }
        _ => bail!("Unsupported Tara source tensor type"),
    }
    for v in &mut result {
        *v = half::f16::from_f32(*v).to_f32();
        if !v.is_finite() {
            bail!("Non-finite Tara weight after float16 intermediate");
        }
    }
    Ok(result)
}
fn quantize(values: &[f32], row_size: usize) -> (Vec<u8>, Vec<f32>) {
    let mut bytes = Vec::with_capacity(values.len());
    let mut scales = vec![];
    for row in values.chunks_exact(row_size) {
        let max = row.iter().fold(0_f32, |a, v| a.max(v.abs()));
        let scale = if max == 0. {
            1.
        } else {
            127. / max.max(127. / f32::MAX)
        };
        scales.push(scale);
        bytes.extend(
            row.iter()
                .map(|v| (v * scale).round_ties_even().clamp(-127., 127.) as i8 as u8),
        );
    }
    (bytes, scales)
}
fn recipes() -> BTreeMap<String, Recipe> {
    let mut map = BTreeMap::new();
    for side in ["encoder", "decoder"] {
        map.insert(
            format!("{side}/num_heads"),
            Recipe::Scalar(20_i16.to_le_bytes().to_vec(), 2),
        );
        for (to, from) in [
            ("layer_norm/gamma", "layer_norm.weight"),
            ("layer_norm/beta", "layer_norm.bias"),
            ("position_encodings/encodings", "embed_positions.weight"),
        ] {
            map.insert(
                format!("{side}/{to}"),
                Recipe::Tensor(vec![format!("model.{side}.{from}")], false),
            );
        }
        for layer in 0..32 {
            let src = format!("model.{side}.layers.{layer}");
            let dst = format!("{side}/layer_{layer}");
            let mut attention = vec![("self_attention", "self_attn", true)];
            if side == "decoder" {
                attention.push(("attention", "encoder_attn", false));
            }
            for (target, source, self_attention) in attention {
                for (to, from) in [("gamma", "weight"), ("beta", "bias")] {
                    map.insert(
                        format!("{dst}/{target}/layer_norm/{to}"),
                        Recipe::Tensor(vec![format!("{src}.{source}_layer_norm.{from}")], false),
                    );
                }
                let projections: Vec<Vec<&str>> = if self_attention {
                    vec![vec!["q_proj", "k_proj", "v_proj"], vec!["out_proj"]]
                } else {
                    vec![vec!["q_proj"], vec!["k_proj", "v_proj"], vec!["out_proj"]]
                };
                for (index, parts) in projections.iter().enumerate() {
                    for suffix in ["weight", "bias"] {
                        map.insert(
                            format!("{dst}/{target}/linear_{index}/{suffix}"),
                            Recipe::Tensor(
                                parts
                                    .iter()
                                    .map(|p| format!("{src}.{source}.{p}.{suffix}"))
                                    .collect(),
                                suffix == "weight",
                            ),
                        );
                    }
                }
            }
            for (to, from) in [("gamma", "weight"), ("beta", "bias")] {
                map.insert(
                    format!("{dst}/ffn/layer_norm/{to}"),
                    Recipe::Tensor(vec![format!("{src}.final_layer_norm.{from}")], false),
                );
            }
            for (index, source) in [(0, "fc1"), (1, "fc2")] {
                for suffix in ["weight", "bias"] {
                    map.insert(
                        format!("{dst}/ffn/linear_{index}/{suffix}"),
                        Recipe::Tensor(
                            vec![format!("{src}.{source}.{suffix}")],
                            suffix == "weight",
                        ),
                    );
                }
            }
        }
    }
    for conv in ["conv1", "conv2"] {
        for suffix in ["weight", "bias"] {
            map.insert(
                format!("encoder/{conv}/{suffix}"),
                Recipe::Tensor(
                    vec![format!("model.encoder.{conv}.{suffix}")],
                    suffix == "weight",
                ),
            );
        }
    }
    map.insert(
        "decoder/embeddings/weight".into(),
        Recipe::Tensor(vec!["model.decoder.embed_tokens.weight".into()], true),
    );
    for name in [
        "pre_norm",
        "alibi",
        "alibi_use_positive_positions",
        "scale_alibi",
        "start_from_zero_embedding",
        "scale_embeddings",
    ] {
        map.insert(
            format!("decoder/{name}"),
            Recipe::Scalar(vec![u8::from(name == "pre_norm")], 1),
        );
    }
    map.insert("decoder/activation".into(), Recipe::Scalar(vec![3], 1)); // GELU, not GELU-tanh.
    map.insert(
        "decoder/alignment_layer".into(),
        Recipe::Scalar((-1_i16).to_le_bytes().to_vec(), 2),
    );
    map.insert(
        "decoder/alignment_heads".into(),
        Recipe::Scalar(1_i16.to_le_bytes().to_vec(), 2),
    );
    map
}
pub fn convert(source: &Path, target: &Path, emit: &Emit, cancel: &Cancel) -> Result<()> {
    let assets: Value = serde_json::from_str(include_str!("../assets/tara-source.json"))?;
    for entry in assets["files"].as_array().unwrap().iter().filter(|f| {
        matches!(
            f["name"].as_str(),
            Some("model.safetensors" | "config.json" | "generation_config.json" | "tokenizer.json")
        )
    }) {
        check_cancel(cancel)?;
        let name = entry["name"].as_str().unwrap();
        if !crate::models::verified(
            &source.join(name),
            entry["size"].as_u64().unwrap(),
            entry["sha256"].as_str().unwrap(),
        ) {
            bail!("Pinned Tara source checksum/size mismatch: {name}");
        }
    }
    let config: Value = serde_json::from_reader(File::open(source.join("config.json"))?)?;
    for (key, value) in [
        ("d_model", 1280),
        ("encoder_layers", 32),
        ("decoder_layers", 32),
        ("num_mel_bins", 128),
        ("vocab_size", 51904),
    ] {
        if config[key] != value {
            bail!("Unsupported Tara architecture: {key}");
        }
    }
    let generation: Value =
        serde_json::from_reader(File::open(source.join("generation_config.json"))?)?;
    let tokenizer: Value = serde_json::from_reader(File::open(source.join("tokenizer.json"))?)?;
    let mut vocabulary = vec![String::new(); 51904];
    for (text, id) in tokenizer["model"]["vocab"]
        .as_object()
        .context("Missing vocabulary")?
    {
        let id = id.as_u64().context("Invalid vocabulary ID")? as usize;
        *vocabulary
            .get_mut(id)
            .context("Vocabulary ID out of range")? = text.clone();
    }
    for token in tokenizer["added_tokens"]
        .as_array()
        .context("Missing special tokens")?
    {
        let id = token["id"].as_u64().context("Invalid special token ID")? as usize;
        *vocabulary
            .get_mut(id)
            .context("Special token out of range")? = token["content"]
            .as_str()
            .context("Missing special token")?
            .into();
    }
    // Match WhisperLoader.get_vocabulary: Tara's tokenizer stops at 51866,
    // while its padded embedding matrix has 51904 rows. These extra timestamp
    // entries are always suppressed. Token 50256 is intentionally the empty token.
    for id in 51867..51904 {
        vocabulary[id] = format!("<|{:.2}|>", (id - 51867) as f64 * 0.02);
    }
    if vocabulary
        .iter()
        .enumerate()
        .any(|(i, t)| i != 50256 && t.is_empty())
        || vocabulary[51866] != "<|mixedcode|>"
    {
        bail!("Tara vocabulary is incomplete");
    }
    fs::create_dir_all(target)?;
    // A failed conversion cannot leave a previous ready marker on changed files.
    let marker = target.join("installed.json");
    if marker.exists() {
        fs::remove_file(&marker)?;
    }
    let input = File::open(source.join("model.safetensors"))?;
    let mmap = unsafe { memmap2::MmapOptions::new().map(&input)? };
    let tensors = safetensors::SafeTensors::deserialize(&mmap)?;
    let recipes = recipes();
    let count = recipes.len()
        + recipes
            .values()
            .filter(|r| matches!(r, Recipe::Tensor(_, true)))
            .count();
    let temporary = target.join("model.bin.conversion.part");
    let mut output = BufWriter::new(File::create(&temporary)?);
    output.write_all(&6_u32.to_le_bytes())?;
    string(&mut output, "WhisperSpec")?;
    output.write_all(&3_u32.to_le_bytes())?;
    output.write_all(&(count as u32).to_le_bytes())?;
    for (index, (name, recipe)) in recipes.iter().enumerate() {
        check_cancel(cancel)?;
        match recipe {
            Recipe::Scalar(bytes, dtype) => variable(&mut output, name, &[], *dtype, bytes)?,
            Recipe::Tensor(sources, quantized) => {
                let mut shape: Vec<usize> = vec![];
                let mut combined = vec![];
                for source in sources {
                    if let Ok(tensor) = tensors.tensor(source) {
                        let s = tensor.shape().to_vec();
                        if shape.is_empty() {
                            shape = s.clone();
                        } else {
                            if shape[1..] != s[1..] {
                                bail!("Cannot fuse incompatible Tara projections");
                            }
                            shape[0] += s[0];
                        }
                        combined.extend(values(tensor)?);
                    } else if source.ends_with(".k_proj.bias") {
                        // Whisper key projections have no bias; the fused QKV/KV tensor needs zeros.
                        if shape.is_empty() {
                            shape = vec![1280];
                        } else {
                            shape[0] += 1280;
                        }
                        combined.extend(std::iter::repeat_n(0., 1280));
                    } else {
                        bail!("Required Tara tensor is missing: {source}");
                    }
                }
                if *quantized {
                    let (bytes, scales) = quantize(&combined, shape[1..].iter().product());
                    variable(&mut output, name, &shape, 1, &bytes)?;
                    let bytes: Vec<_> = scales.iter().flat_map(|v| v.to_le_bytes()).collect();
                    variable(
                        &mut output,
                        &format!("{name}_scale"),
                        &[shape[0]],
                        0,
                        &bytes,
                    )?;
                } else {
                    let bytes: Vec<_> = combined.iter().flat_map(|v| v.to_le_bytes()).collect();
                    variable(&mut output, name, &shape, 0, &bytes)?;
                }
            }
        }
        emit(
            "progress",
            json!({"stage":"converting","message":name,"completed":index+1,"total":recipes.len()}),
        );
    }
    output.write_all(&2_u32.to_le_bytes())?;
    string(&mut output, "decoder/projection/weight")?;
    string(&mut output, "decoder/embeddings/weight")?;
    string(&mut output, "decoder/projection/weight_scale")?;
    string(&mut output, "decoder/embeddings/weight_scale")?;
    output.flush()?;
    output.get_ref().sync_all()?;
    drop(output);
    let model = target.join("model.bin");
    if model.exists() {
        fs::remove_file(&model)?;
    }
    fs::rename(temporary, model)?;
    fs::write(
        target.join("vocabulary.json"),
        serde_json::to_vec(&vocabulary)?,
    )?;
    fs::write(
        target.join("config.json"),
        serde_json::to_vec_pretty(&json!({
        "suppress_ids":generation["suppress_tokens"],"suppress_ids_begin":generation["begin_suppress_tokens"],
        "lang_ids":generation["lang_to_id"].as_object().map(|m| m.values().cloned().collect::<Vec<_>>()),
        "alignment_heads":generation["alignment_heads"],"decoder_start_token":"<|startoftranscript|>"}))?,
    )?;
    let mut files = vec![];
    for name in ["model.bin", "vocabulary.json", "config.json"] {
        let path = target.join(name);
        files.push(json!({"name":name,"size":fs::metadata(&path)?.len(),"sha256":crate::audio::digest(&path)?}));
    }
    fs::write(
        marker,
        serde_json::to_vec_pretty(
            &json!({"format":"aiditor-tara-ct2-v1","sourceRevision":"4dd4782d65ed8c9690b52478e4419d577fff40be",
        "computeType":"int8_float32","conversionIntermediate":"float16","mixedcodeToken":51866,"nMels":128,"files":files,"lossy":true}),
        )?,
    )?;
    if source.join("README.md").is_file() {
        fs::copy(source.join("README.md"), target.join("README.tara.md"))?;
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn quantization_matches_row_scales_zero_rows_and_even_rounding() {
        let (bytes, scales) = quantize(&[0., 0., 1., -1., 0.5, -0.5], 2);
        assert_eq!(scales, vec![1., 127., 254.]);
        assert_eq!(bytes, vec![0, 0, 127, 129, 127, 129]);
        let (bytes, _) = quantize(&[127., 0.5, 1.5, 2.5], 4);
        assert_eq!(bytes, vec![127, 0, 2, 2]);
    }
}
