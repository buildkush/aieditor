//! Whisper's 30 s / 128-mel input, without Torch, NumPy or a loaded ASR model.
use anyhow::{Result, bail};
use rustfft::{FftPlanner, num_complex::Complex};
use std::sync::{Arc, OnceLock};
struct Kernel {
    fft: Arc<dyn rustfft::Fft<f64>>,
    window: Vec<f64>,
    filters: Vec<f64>,
}
pub fn log_mel(samples: &[f32]) -> Result<Vec<f32>> {
    if samples.is_empty() || samples.len() > 480000 || samples.iter().any(|v| !v.is_finite()) {
        bail!("Whisper features require finite mono 16 kHz audio of at most 30 seconds");
    }
    static KERNEL: OnceLock<Kernel> = OnceLock::new();
    let kernel = KERNEL.get_or_init(|| Kernel {
        fft: FftPlanner::new().plan_fft_forward(400),
        window: (0..400)
            .map(|n| 0.5 - 0.5 * (2. * std::f64::consts::PI * n as f64 / 400.).cos())
            .collect(),
        filters: crate::convert::mel_filters()
            .expect("Bundled mel filters are validated by tests")
            .chunks_exact(4)
            .map(|b| f32::from_le_bytes(b.try_into().unwrap()) as f64)
            .collect(),
    });
    let mut output = vec![0.; 128 * 3000];
    let mut buffer = vec![Complex::new(0., 0.); 400];
    let mut scratch = vec![Complex::new(0., 0.); kernel.fft.get_inplace_scratch_len()];
    let mut maximum = f32::NEG_INFINITY;
    for frame in 0..3000 {
        for (i, value) in buffer.iter_mut().enumerate() {
            let at = (frame * 160 + i) as isize - 200;
            let at = if at < 0 {
                -at
            } else if at >= 480000 {
                959998 - at
            } else {
                at
            } as usize;
            *value = Complex::new(
                samples.get(at).copied().unwrap_or(0.) as f64 * kernel.window[i],
                0.,
            );
        }
        kernel.fft.process_with_scratch(&mut buffer, &mut scratch);
        let mut power = [0.; 201];
        for (p, f) in power.iter_mut().zip(&buffer) {
            *p = f.norm_sqr();
        }
        for (mel, weights) in kernel.filters.chunks_exact(201).enumerate() {
            let value = weights
                .iter()
                .zip(power)
                .map(|(w, p)| w * p)
                .sum::<f64>()
                .max(1e-10)
                .log10() as f32;
            output[mel * 3000 + frame] = value;
            maximum = maximum.max(value);
        }
    }
    for value in &mut output {
        *value = (value.max(maximum - 8.) + 4.) / 4.;
    }
    Ok(output)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn silence_has_the_whisper_floor_and_correct_layout() {
        let mel = log_mel(&[0.; 320]).unwrap();
        assert_eq!(mel.len(), 128 * 3000);
        assert!(mel.iter().all(|v| (*v + 1.5).abs() < 1e-6));
        assert!(log_mel(&[f32::NAN]).is_err());
        assert!(log_mel(&[]).is_err());
    }
}
