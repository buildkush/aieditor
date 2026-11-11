//! Rust-only safetensors -> Whisper GGML conversion. Quantization is lossy.
use crate::{Cancel, Emit, audio::digest, check_cancel};
use anyhow::{Context, Result, bail};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    fs::{self, File},
    io::{BufWriter, Cursor, Read, Write},
    path::Path,
};
use whisper_rs::whisper_rs_sys as ffi;
fn i32_write(out: &mut impl Write, n: i32) -> Result<()> {
    out.write_all(&n.to_le_bytes())?;
    Ok(())
}
pub fn tensor_name(name: &str) -> Option<String> {
    let name = name.strip_prefix("model.").unwrap_or(name);
    if name == "proj_out.weight" {
        return None;
    }
    let replacements = [
        ("self_attn.k_proj", "attn.key"),
        ("self_attn.q_proj", "attn.query"),
        ("self_attn.v_proj", "attn.value"),
        ("self_attn.out_proj", "attn.out"),
        ("self_attn_layer_norm", "attn_ln"),
        ("encoder_attn.k_proj", "cross_attn.key"),
        ("encoder_attn.q_proj", "cross_attn.query"),
        ("encoder_attn.v_proj", "cross_attn.value"),
        ("encoder_attn.out_proj", "cross_attn.out"),
        ("encoder_attn_layer_norm", "cross_attn_ln"),
        ("final_layer_norm", "mlp_ln"),
        ("fc1", "mlp.0"),
        ("fc2", "mlp.2"),
        ("encoder.layer_norm", "encoder.ln_post"),
        ("decoder.layer_norm", "decoder.ln"),
        ("embed_positions.weight", "positional_embedding"),
        ("embed_tokens.weight", "token_embedding.weight"),
    ];
    let mut result = name.replace(".layers.", ".blocks.");
    for (from, to) in replacements {
        result = result.replace(from, to)
    }
    Some(result)
}
pub(crate) fn token_bytes(token: &str) -> Result<Vec<u8>> {
    static ALPHABET: std::sync::OnceLock<HashMap<char, u8>> = std::sync::OnceLock::new();
    let inverse = ALPHABET.get_or_init(|| {
        let mut bytes: Vec<u32> = (33..=126).chain(161..=172).chain(174..=255).collect();
        let mut chars = bytes.clone();
        let mut next = 256;
        for byte in 0..=255 {
            if !bytes.contains(&byte) {
                bytes.push(byte);
                chars.push(next);
                next += 1;
            }
        }
        chars
            .iter()
            .zip(bytes.iter())
            .map(|(c, b)| (char::from_u32(*c).unwrap(), *b as u8))
            .collect()
    });
    token
        .chars()
        .map(|c| {
            inverse
                .get(&c)
                .copied()
                .context("Invalid tokenizer byte alphabet")
        })
        .collect()
}
pub(crate) fn mel_filters() -> Result<Vec<u8>> {
    let mut zip = zip::ZipArchive::new(Cursor::new(
        include_bytes!("../assets/mel_filters.npz").as_slice(),
    ))?;
    let mut data = Vec::new();
    zip.by_name("mel_128.npy")?.read_to_end(&mut data)?;
    if data.get(..6) != Some(b"\x93NUMPY") {
        bail!("Invalid pinned mel filters")
    }
    let header = if data[6] == 1 {
        10 + u16::from_le_bytes([data[8], data[9]]) as usize
    } else {
        12 + u32::from_le_bytes(data[8..12].try_into()?) as usize
    };
    let body = data[header..].to_vec();
    if body.len() != 128 * 201 * 4 {
        bail!("Wrong mel filter dimensions")
    }
    Ok(body)
}
pub fn tara(source: &Path, target: &Path, q5: bool, emit: &Emit, cancel: &Cancel) -> Result<()> {
    let config: Value = serde_json::from_reader(File::open(source.join("config.json"))?)?;
    for (key, expected) in [
        ("d_model", 1280),
        ("encoder_layers", 32),
        ("decoder_layers", 32),
        ("num_mel_bins", 128),
        ("vocab_size", 51904),
        ("encoder_attention_heads", 20),
        ("decoder_attention_heads", 20),
    ] {
        if config[key] != expected {
            bail!("Unsupported Tara architecture: {key}")
        }
    }
    let tokenizer: Value = serde_json::from_reader(File::open(source.join("tokenizer.json"))?)?;
    let mut tokens = vec![Vec::new(); 51904];
    for (token, id) in tokenizer["model"]["vocab"]
        .as_object()
        .context("Missing tokenizer vocabulary")?
    {
        let id = id.as_u64().context("Invalid token ID")? as usize;
        if id >= tokens.len() {
            bail!("Token ID exceeds vocabulary")
        }
        tokens[id] = token_bytes(token)?;
    }
    for token in tokenizer["added_tokens"]
        .as_array()
        .context("Missing added tokens")?
    {
        let id = token["id"].as_u64().context("Invalid added token")? as usize;
        if id >= tokens.len() {
            bail!("Added token ID exceeds vocabulary")
        }
        tokens[id] = token["content"]
            .as_str()
            .context("Invalid added token text")?
            .as_bytes()
            .to_vec();
    }
    if tokens[51866] != b"<|mixedcode|>"
        || tokens[50258] != b"<|startoftranscript|>"
        || tokens[50364] != b"<|notimestamps|>"
    {
        bail!("Tara special token IDs were not preserved")
    }
    for (id, token) in tokens.iter_mut().enumerate() {
        if token.is_empty() {
            *token = format!("[_PAD_{id}]").into_bytes();
        }
    }
    let generation: Value =
        serde_json::from_reader(File::open(source.join("generation_config.json"))?)?;
    let original = File::open(source.join("model.safetensors"))?;
    // The immutable mapping stays alive while tensor views are read.
    let mmap = unsafe { memmap2::MmapOptions::new().map(&original)? };
    let tensors = safetensors::SafeTensors::deserialize(&mmap)?;
    let temp = target.with_extension("conversion.part");
    let mut out = BufWriter::new(File::create(&temp)?);
    for n in [
        0x67676d6c,
        51904,
        1500,
        1280,
        20,
        32,
        448,
        1280,
        20,
        32,
        128,
        2000 + if q5 { 8 } else { 7 },
        128,
        201,
    ] {
        i32_write(&mut out, n)?;
    }
    out.write_all(&mel_filters()?)?;
    i32_write(&mut out, tokens.len() as i32)?;
    for token in tokens {
        i32_write(&mut out, token.len() as i32)?;
        out.write_all(&token)?;
    }
    let mut names = tensors.names();
    names.sort();
    let mut written = 0;
    let mut embedding = false;
    for name in &names {
        check_cancel(cancel)?;
        let Some(mapped) = tensor_name(name) else {
            continue;
        };
        if mapped == "decoder.token_embedding.weight" {
            embedding = true
        }
        let tensor = tensors.tensor(name)?;
        let shape = tensor.shape();
        let mut values = Vec::with_capacity(shape.iter().product());
        match tensor.dtype() {
            safetensors::Dtype::BF16 => {
                for b in tensor.data().chunks_exact(2) {
                    values.push(half::bf16::from_le_bytes(b.try_into()?).to_f32())
                }
            }
            safetensors::Dtype::F16 => {
                for b in tensor.data().chunks_exact(2) {
                    values.push(half::f16::from_le_bytes(b.try_into()?).to_f32())
                }
            }
            safetensors::Dtype::F32 => {
                for b in tensor.data().chunks_exact(4) {
                    values.push(f32::from_le_bytes(b.try_into()?))
                }
            }
            _ => bail!("Unsupported tensor dtype"),
        }
        let mut dims: Vec<_> = shape.iter().copied().filter(|n| *n != 1).collect();
        if dims.is_empty() {
            dims.push(1)
        }
        let mut dtype = 0u32;
        let mut bytes: Vec<u8>;
        if dims.len() == 2 && mapped.ends_with(".weight") && dims[1] % 32 == 0 {
            dtype = if q5 { 6 } else { 8 };
            bytes = vec![0; values.len() * 4];
            let n = unsafe {
                ffi::ggml_quantize_chunk(
                    dtype,
                    values.as_ptr(),
                    bytes.as_mut_ptr().cast(),
                    0,
                    dims[0] as i64,
                    dims[1] as i64,
                    std::ptr::null(),
                )
            };
            if n == 0 || n > bytes.len() {
                bail!("Native quantization failed")
            }
            bytes.truncate(n);
        } else if dims.len() > 1 && !mapped.ends_with("positional_embedding") {
            dtype = 1;
            bytes = values
                .iter()
                .flat_map(|v| half::f16::from_f32(*v).to_le_bytes())
                .collect();
        } else {
            bytes = values.iter().flat_map(|v| v.to_le_bytes()).collect();
        }
        if mapped == "encoder.conv1.bias" || mapped == "encoder.conv2.bias" {
            dims.push(1);
        }
        i32_write(&mut out, dims.len() as i32)?;
        i32_write(&mut out, mapped.len() as i32)?;
        i32_write(&mut out, dtype as i32)?;
        for dim in dims.iter().rev() {
            i32_write(&mut out, *dim as i32)?
        }
        out.write_all(mapped.as_bytes())?;
        out.write_all(&bytes)?;
        written += 1;
        emit(
            "progress",
            json!({"stage":"converting","message":mapped,"completed":written,"total":names.len()}),
        );
    }
    if !embedding {
        bail!("Missing tied decoder embedding; refusing an incomplete GGML model")
    }
    out.flush()?;
    out.get_ref().sync_all()?;
    drop(out);
    check_cancel(cancel)?;
    let sha = digest(&temp)?;
    let size = fs::metadata(&temp)?.len();
    if target.exists() {
        fs::remove_file(target)?
    }
    fs::rename(&temp, target)?;
    let marker = json!({"format":"aiditor-tara-ggml-v1","mixedcodeToken":51866,"nMels":128,"nVocab":51904,"quantization":if q5{"q5_0"}else{"q8_0"},"sha256":sha,"size":size,"alignmentHeads":generation["alignment_heads"],"lossy":true});
    fs::write(
        target.with_extension("json"),
        serde_json::to_vec_pretty(&marker)?,
    )?;
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn tensor_mapping_preserves_cross_attention() {
        assert_eq!(
            tensor_name("model.decoder.layers.2.encoder_attn.k_proj.weight").unwrap(),
            "decoder.blocks.2.cross_attn.key.weight"
        );
    }
    #[test]
    fn byte_bpe_reconstructs_whitespace() {
        assert_eq!(token_bytes("Ġhello").unwrap(), b" hello");
    }
    #[test]
    fn mel_asset_is_128_by_201() {
        assert_eq!(mel_filters().unwrap().len(), 128 * 201 * 4);
    }
}
