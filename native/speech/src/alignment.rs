//! Constrain native DTW with acoustic speech evidence, never evenly spaced words.
use crate::Word;
use serde_json::{Value, json};
pub fn constrain(
    words: &mut [Word],
    speech: &[(usize, usize)],
    duration: f64,
) -> (Vec<Value>, usize) {
    let mut regions: Vec<(f64, f64, Vec<(f64, f64)>)> = vec![];
    for &(a, b) in speech {
        let (actual_a, actual_b) = (a as f64 / 16000., b as f64 / 16000.);
        let (a, b) = ((actual_a - 0.06).max(0.), (actual_b + 0.06).min(duration));
        if let Some(last) = regions.last_mut().filter(|last| a - last.1 < 0.35) {
            last.1 = b;
            last.2.push((actual_a, actual_b));
        } else {
            regions.push((a, b, vec![(actual_a, actual_b)]));
        }
    }
    let mut adjustments = vec![];
    let mut unresolved = 0;
    for (index, word) in words.iter_mut().enumerate() {
        let (begin, end) = (word.start_time, word.end_time);
        let intersections: Vec<_> = regions
            .iter()
            .filter_map(|&(a, b, _)| {
                let (a, b) = (begin.max(a), end.min(b));
                (b > a).then_some((a, b))
            })
            .collect();
        let substantial: Vec<_> = regions
            .iter()
            .filter(|(_, _, parts)| {
                parts
                    .iter()
                    .map(|&(a, b)| (end.min(b) - begin.max(a)).max(0.))
                    .sum::<f64>()
                    > 0.2
            })
            .map(|&(a, b, _)| (begin.max(a), end.min(b)))
            .collect();
        let chosen = if intersections.len() == 1 {
            Some(intersections[0])
        } else if substantial.len() == 1 {
            Some(substantial[0])
        } else {
            None
        };
        if let Some((a, b)) = chosen {
            if a - begin >= 0.35 {
                word.start_time = a;
            }
            if end - b >= 0.35 {
                word.end_time = b;
            }
            if word.start_time != begin || word.end_time != end {
                adjustments.push(
                    json!({"wordIndex":index,"originalStartTime":begin,"originalEndTime":end,
                    "startTime":word.start_time,"endTime":word.end_time}),
                );
            }
        } else {
            // No invented replacement: retain the original interval for explicit review.
            unresolved += 1;
            word.timing_needs_review = true;
        }
    }
    (adjustments, unresolved)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn acoustic_bounds_trim_pauses_without_guessing_ambiguous_words() {
        let mut words = vec![Word {
            text: "hello".into(),
            start_time: 0.,
            end_time: 2.5,
            confidence: None,
            timing_needs_review: true,
        }];
        let (changes, unresolved) = constrain(&mut words, &[(2 * 16000, 3 * 16000)], 3.);
        assert_eq!(unresolved, 0);
        assert_eq!(changes.len(), 1);
        assert_eq!(words[0].start_time, 1.94);
        assert_eq!(words[0].end_time, 2.5);
        let mut ambiguous = vec![Word {
            text: "hello".into(),
            start_time: 0.,
            end_time: 3.,
            confidence: None,
            timing_needs_review: true,
        }];
        let (changes, unresolved) =
            constrain(&mut ambiguous, &[(0, 16000), (2 * 16000, 3 * 16000)], 3.);
        assert!(changes.is_empty());
        assert_eq!(unresolved, 1);
        assert_eq!(ambiguous[0].end_time, 3.);
    }
}
