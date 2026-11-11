//! Pause-aware windows preserve every recognition sample and the original clock.
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chunk {
    pub core_start: usize,
    pub core_end: usize,
    pub input_start: usize,
    pub input_end: usize,
}
pub fn plan(length: usize, speech: &[(usize, usize)]) -> Result<Vec<Chunk>> {
    if length == 0 {
        bail!("Cannot chunk empty audio");
    }
    let mut previous = 0;
    let mut gaps = vec![];
    for &(a, b) in speech {
        if !(previous <= a && a < b && b <= length) {
            bail!("Invalid speech intervals");
        }
        if a - previous >= 2400 {
            gaps.push((previous, a));
        }
        previous = b;
    }
    if length - previous >= 2400 {
        gaps.push((previous, length));
    }
    let mut result = vec![];
    let (mut start, mut previous_forced) = (0, false);
    while start < length {
        let incoming = if previous_forced { 9600 } else { 0 };
        let mut end = if length - start + incoming <= 480000 {
            length
        } else {
            start + 460800
        };
        let mut forced = false;
        if end < length {
            let left = start + 240000;
            let candidate = gaps
                .iter()
                .filter_map(|&(a, b)| {
                    let (a, b) = (a.max(left), b.min(end));
                    (b >= a + 2400).then_some((a + b) / 2)
                })
                .min_by_key(|&center| (center.abs_diff(start + 416000), usize::MAX - center));
            if let Some(center) = candidate {
                end = center;
            } else {
                forced = true;
            }
        }
        let c = Chunk {
            core_start: start,
            core_end: end,
            input_start: start.saturating_sub(incoming),
            input_end: (end + if forced { 9600 } else { 0 }).min(length),
        };
        if c.input_end - c.input_start > 480000 {
            bail!("Chunk exceeds Whisper audio context");
        }
        result.push(c);
        start = end;
        previous_forced = forced;
    }
    Ok(result)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn forced_boundaries_preserve_coverage_and_limit_context() {
        let length = 83 * 16000;
        let chunks = plan(length, &[(0, length)]).unwrap();
        assert!(chunks.len() > 1);
        let mut end = 0;
        for c in chunks {
            assert_eq!(c.core_start, end);
            assert!(c.input_start <= c.core_start);
            assert!(c.input_end >= c.core_end);
            assert!(c.input_end - c.input_start <= 480000);
            end = c.core_end;
        }
        assert_eq!(end, length);
        assert!(plan(length, &[(100, 50)]).is_err());
    }
    #[test]
    fn uses_pause_instead_of_cutting_speech() {
        let chunks = plan(60 * 16000, &[(0, 22 * 16000), (23 * 16000, 60 * 16000)]).unwrap();
        assert_eq!(chunks[0].core_end, 360000);
        assert_eq!(chunks[0].input_end, chunks[1].input_start);
    }
}
