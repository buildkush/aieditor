use crate::{Cancel, Emit, check_cancel, hidden};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    thread,
    time::Duration,
};
pub const RATE: usize = 16000;
const MAX_SAMPLES: usize = RATE * 60 * 60 * 2;
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Clip {
    pub id: String,
    pub path: PathBuf,
    pub start_time: f64,
    pub duration: f64,
    pub source_in: f64,
    pub source_out: f64,
    pub speed: f64,
    pub reversed: bool,
    pub gain: Vec<[f64; 2]>,
}
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Plan {
    pub project_id: String,
    pub clips: Vec<Clip>,
    pub duration: f64,
}
pub struct Prepared {
    pub samples: Vec<f32>,
    pub path: PathBuf,
    pub sha256: String,
}
impl Prepared {
    pub fn duration(&self) -> f64 {
        self.samples.len() as f64 / RATE as f64
    }
}
pub fn digest(path: &Path) -> Result<String> {
    let mut file = File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    Ok(hex::encode(hash.finalize()))
}
pub fn command(command: &mut Command, cancel: &Cancel) -> Result<()> {
    check_cancel(cancel)?;
    hidden(command);
    // Do not keep an unread diagnostics pipe that could block FFmpeg before exit.
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| anyhow::anyhow!("Cannot start FFmpeg at {}: {error}. Run setup.cmd or set AIDITOR_FFMPEG to its executable.", command.get_program().to_string_lossy()))?;
    loop {
        if let Err(error) = check_cancel(cancel) {
            let _ = child.kill();
            let _ = child.wait();
            return Err(error);
        }
        if let Some(status) = child.try_wait()? {
            if !status.success() {
                bail!("FFmpeg failed ({status}); check the input file and audio stream")
            }
            return Ok(());
        }
        thread::sleep(Duration::from_millis(50));
    }
}
fn find_ffmpeg(
    override_path: Option<std::ffi::OsString>,
    search_path: Option<std::ffi::OsString>,
    install_roots: &[PathBuf],
    bundled: Option<PathBuf>,
) -> Result<PathBuf> {
    if let Some(path) = override_path.filter(|p| !p.is_empty()) {
        let path = PathBuf::from(path);
        if path.is_file() {
            return Ok(path);
        }
        bail!(
            "AIDITOR_FFMPEG points to a missing executable: {}",
            path.display()
        )
    }
    let executable = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    if let Some(path) = bundled.filter(|p| p.is_file()) {
        return Ok(path);
    }
    if let Some(search_path) = search_path {
        for directory in std::env::split_paths(&search_path).filter(|p| p.is_absolute()) {
            let path = directory.join(executable);
            if path.is_file() {
                return Ok(path);
            }
        }
    }
    // WinGet updates persistent PATH, but an already-running desktop/terminal
    // retains its old environment. Find the installed package directly without
    // changing global PATH or scanning unrelated application directories.
    for winget in install_roots {
        let alias = winget.join("Links").join(executable);
        if alias.is_file() {
            return Ok(alias);
        }
        let Ok(packages) = fs::read_dir(winget.join("Packages")) else {
            continue;
        };
        let mut packages: Vec<_> = packages
            .flatten()
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .starts_with("gyan.ffmpeg_")
            })
            .map(|entry| entry.path())
            .collect();
        packages.sort();
        for package in packages.into_iter().rev() {
            for path in [
                package.join(executable),
                package.join("bin").join(executable),
            ] {
                if path.is_file() {
                    return Ok(path);
                }
            }
            if let Ok(versions) = fs::read_dir(package) {
                for version in versions.flatten() {
                    let path = version.path().join("bin").join(executable);
                    if path.is_file() {
                        return Ok(path);
                    }
                }
            }
        }
    }
    bail!(
        "FFmpeg was not found. Run setup.cmd, or set AIDITOR_FFMPEG to the full ffmpeg executable path."
    )
}
fn ffmpeg() -> Result<Command> {
    let mut roots = Vec::new();
    if let Some(local) = std::env::var_os("LOCALAPPDATA") {
        roots.push(PathBuf::from(local).join("Microsoft/WinGet"));
    }
    if let Some(program_files) = std::env::var_os("ProgramFiles") {
        roots.push(PathBuf::from(program_files).join("WinGet"));
    }
    let bundled = std::env::current_exe().ok().and_then(|p| {
        p.parent().map(|p| {
            p.join(if cfg!(windows) {
                "ffmpeg.exe"
            } else {
                "ffmpeg"
            })
        })
    });
    Ok(Command::new(find_ffmpeg(
        std::env::var_os("AIDITOR_FFMPEG"),
        std::env::var_os("PATH"),
        &roots,
        bundled,
    )?))
}
fn read_pcm(path: &Path) -> Result<Vec<f32>> {
    let size = fs::metadata(path)?.len();
    if size == 0 || size % 4 != 0 || size / 4 > MAX_SAMPLES as u64 {
        bail!("Invalid or oversized decoded audio (maximum two hours per job)")
    }
    let bytes = fs::read(path)?;
    let samples: Vec<_> = bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
        .collect();
    if samples.iter().any(|v| !v.is_finite()) {
        bail!("Decoded audio contains nonfinite samples")
    }
    Ok(samples)
}
fn save(root: &Path, key: &str, samples: Vec<f32>) -> Result<Prepared> {
    let cache = root.join("audio");
    fs::create_dir_all(&cache)?;
    let target = cache.join(format!("native-{key}.f32"));
    let temp = cache.join(format!("{}.part", uuid::Uuid::new_v4()));
    let mut file = File::create(&temp)?;
    for block in samples.chunks(RATE * 10) {
        let bytes: Vec<_> = block
            .iter()
            .flat_map(|s| s.clamp(-1., 1.).to_le_bytes())
            .collect();
        file.write_all(&bytes)?;
    }
    file.sync_all()?;
    drop(file);
    if target.exists() {
        fs::remove_file(&temp)?
    } else {
        fs::rename(&temp, &target)?
    }
    Ok(Prepared {
        sha256: digest(&target)?,
        samples,
        path: target,
    })
}
pub fn prepare_file(root: &Path, path: &Path, emit: &Emit, cancel: &Cancel) -> Result<Prepared> {
    check_cancel(cancel)?;
    let path = path.canonicalize().context("Source media is missing")?;
    let hash = digest(&path)?;
    let key = format!("source-v1-{hash}");
    let cache = root.join("audio");
    fs::create_dir_all(&cache)?;
    let target = cache.join(format!("native-{key}.f32"));
    if target.exists() {
        return Ok(Prepared {
            samples: read_pcm(&target)?,
            sha256: digest(&target)?,
            path: target,
        });
    }
    let temp = cache.join(format!("{}.f32.part", uuid::Uuid::new_v4()));
    emit(
        "progress",
        json!({"stage":"audio","message":"Decoding immutable source audio into app cache"}),
    );
    let outcome = command(
        ffmpeg()?
            .args(["-nostdin", "-v", "error", "-i"])
            .arg(&path)
            .args([
                "-map",
                "0:a:0",
                "-vn",
                "-af",
                "aresample=16000:async=1:first_pts=0",
                "-ac",
                "1",
                "-ar",
                "16000",
                "-t",
                "7200.001",
                "-f",
                "f32le",
            ])
            .arg(&temp),
        cancel,
    );
    if let Err(error) = outcome {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    let samples = read_pcm(&temp);
    if samples.is_err() {
        let _ = fs::remove_file(&temp);
    }
    let samples = samples?;
    fs::rename(&temp, &target)?;
    Ok(Prepared {
        samples,
        sha256: digest(&target)?,
        path: target,
    })
}
pub fn validate_plan(plan: &Plan) -> Result<()> {
    if plan.project_id.is_empty()
        || plan.clips.is_empty()
        || plan.clips.len() > 10000
        || !plan.duration.is_finite()
        || plan.duration <= 0.
        || plan.duration * RATE as f64 > MAX_SAMPLES as f64
    {
        bail!("Invalid project audio plan")
    }
    for c in &plan.clips {
        if [c.start_time, c.duration, c.source_in, c.source_out, c.speed]
            .iter()
            .any(|x| !x.is_finite())
            || c.start_time < 0.
            || c.duration <= 0.
            || c.start_time + c.duration > plan.duration + 0.001
            || c.source_in < 0.
            || c.source_out <= c.source_in
            || !(0.25..=4.).contains(&c.speed)
            || !c.path.is_file()
            || c.gain.is_empty()
            || c.gain.len() > 1_000_001
        {
            bail!("Invalid project audio clip")
        }
        let mut prev = 0.;
        for [at, gain] in &c.gain {
            if !at.is_finite()
                || !gain.is_finite()
                || *at < prev
                || *at > c.duration
                || *gain < 0.
                || *gain > 10000.
            {
                bail!("Invalid gain envelope")
            }
            prev = *at;
        }
    }
    Ok(())
}
pub fn gain_at(points: &[[f64; 2]], time: f64) -> f32 {
    if time <= points[0][0] {
        return points[0][1] as f32;
    }
    for pair in points.windows(2) {
        if time <= pair[1][0] {
            let dt = pair[1][0] - pair[0][0];
            return (if dt <= 0. {
                pair[1][1]
            } else {
                pair[0][1] + (pair[1][1] - pair[0][1]) * (time - pair[0][0]) / dt
            }) as f32;
        }
    }
    points.last().unwrap()[1] as f32
}
pub fn prepare_plan(root: &Path, plan: Plan, emit: &Emit, cancel: &Cancel) -> Result<Prepared> {
    validate_plan(&plan)?;
    let mut mix = vec![0f32; (plan.duration * RATE as f64).round() as usize];
    let mut hash = Sha256::new();
    hash.update(serde_json::to_vec(&plan)?);
    for clip in &plan.clips {
        check_cancel(cancel)?;
        let source = prepare_file(root, &clip.path, emit, cancel)?;
        hash.update(&source.sha256);
        let start = if clip.reversed {
            clip.source_in
                .max(clip.source_out - clip.duration * clip.speed)
        } else {
            clip.source_in
        };
        let end = if clip.reversed {
            clip.source_out
        } else {
            clip.source_out
                .min(clip.source_in + clip.duration * clip.speed)
        };
        let first = (start * RATE as f64).round() as usize;
        let last = ((end * RATE as f64).round() as usize).min(source.samples.len());
        let mut samples = if first < last {
            source.samples[first..last].to_vec()
        } else {
            vec![]
        };
        if clip.reversed {
            samples.reverse();
            let original = samples;
            samples = (0..(clip.duration * RATE as f64).round() as usize)
                .map(|i| {
                    let x = i as f64 * clip.speed;
                    let n = x as usize;
                    let a = original.get(n).copied().unwrap_or(0.);
                    let b = original.get(n + 1).copied().unwrap_or(0.);
                    a + (b - a) * (x - n as f64) as f32
                })
                .collect();
        } else if clip.speed != 1. && !samples.is_empty() {
            let input = save(root, &uuid::Uuid::new_v4().to_string(), samples)?;
            let output = root
                .join("audio")
                .join(format!("{}.f32.part", uuid::Uuid::new_v4()));
            let mut rate = clip.speed;
            let mut filters = Vec::new();
            while rate > 2. {
                filters.push("atempo=2".to_string());
                rate /= 2.
            }
            while rate < 0.5 {
                filters.push("atempo=0.5".to_string());
                rate /= 0.5;
            }
            filters.push(format!("atempo={rate}"));
            let result = command(
                ffmpeg()?
                    .args([
                        "-nostdin", "-v", "error", "-f", "f32le", "-ar", "16000", "-ac", "1", "-i",
                    ])
                    .arg(&input.path)
                    .args(["-af", &filters.join(","), "-f", "f32le"])
                    .arg(&output),
                cancel,
            );
            if let Err(error) = result {
                let _ = fs::remove_file(&output);
                return Err(error);
            }
            samples = read_pcm(&output)?;
            fs::remove_file(output)?;
        }
        let offset = (clip.start_time * RATE as f64).round() as usize;
        let count = samples
            .len()
            .min((clip.duration * RATE as f64).round() as usize)
            .min(mix.len().saturating_sub(offset));
        for i in 0..count {
            mix[offset + i] += samples[i] * gain_at(&clip.gain, i as f64 / RATE as f64);
        }
    }
    for value in &mut mix {
        *value = value.clamp(-1., 1.);
    }
    save(
        root,
        &format!("project-v1-{}", hex::encode(hash.finalize())),
        mix,
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn finds_winget_ffmpeg_with_stale_path() {
        let root = std::env::temp_dir().join(format!("aiditor ffmpeg-{}", uuid::Uuid::new_v4()));
        let executable = if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        };
        let expected = root
            .join("Packages/Gyan.FFmpeg_test/ffmpeg-9-full_build/bin")
            .join(executable);
        fs::create_dir_all(expected.parent().unwrap()).unwrap();
        fs::write(&expected, b"path discovery fixture").unwrap();
        assert_eq!(
            find_ffmpeg(None, None, &[root.clone()], None).unwrap(),
            expected
        );
        assert!(
            find_ffmpeg(
                Some(root.join("missing.exe").into_os_string()),
                None,
                &[root.clone()],
                None
            )
            .is_err()
        );
        let custom = root.join("custom.exe");
        fs::write(&custom, b"override fixture").unwrap();
        assert_eq!(
            find_ffmpeg(
                Some(custom.clone().into_os_string()),
                None,
                &[root.clone()],
                None
            )
            .unwrap(),
            custom
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn finds_ffmpeg_in_path_and_reports_missing_installation() {
        let root = std::env::temp_dir().join(format!("aiditor-path-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let executable = root.join(if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        });
        fs::write(&executable, b"path fixture").unwrap();
        assert_eq!(
            find_ffmpeg(
                None,
                Some(std::env::join_paths([&root]).unwrap()),
                &[],
                None
            )
            .unwrap(),
            executable
        );
        assert!(
            find_ffmpeg(None, None, &[], None)
                .unwrap_err()
                .to_string()
                .contains("setup.cmd")
        );
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn gain_preserves_gaps_and_interpolates() {
        assert_eq!(gain_at(&[[0., 0.], [2., 1.]], 1.), 0.5);
    }
    #[test]
    fn empty_plan_is_rejected() {
        assert!(
            validate_plan(&Plan {
                project_id: "x".into(),
                clips: vec![],
                duration: 2.
            })
            .is_err()
        );
    }
    #[test]
    fn project_mix_preserves_source_trim_reverse_gaps_overlap_and_gain() {
        let root = std::env::temp_dir().join(format!("aiditor-mix-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let source = root.join("immutable.media");
        fs::write(&source, b"original source bytes").unwrap();
        let hash = digest(&source).unwrap();
        // Seed decoded PCM to exercise the project mixer without a system FFmpeg.
        let mut pcm = vec![0.2; RATE];
        pcm.extend(vec![0.4; RATE]);
        let mut ramp = vec![0.; RATE];
        for (i, value) in ramp.iter_mut().enumerate() {
            *value = i as f32 / RATE as f32;
        }
        pcm.extend(ramp);
        save(&root, &format!("source-v1-{hash}"), pcm).unwrap();
        let clip = Clip {
            id: "a".into(),
            path: source.clone(),
            start_time: 1.,
            duration: 1.,
            source_in: 1.,
            source_out: 2.,
            speed: 1.,
            reversed: false,
            gain: vec![[0., 0.5]],
        };
        let mut reverse = clip.clone();
        reverse.id = "b".into();
        reverse.start_time = 3.;
        reverse.source_in = 2.;
        reverse.source_out = 3.;
        reverse.reversed = true;
        reverse.gain = vec![[0., 1.]];
        let mut overlap = clip.clone();
        overlap.id = "c".into();
        let emit: Emit = std::sync::Arc::new(|_, _| {});
        let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let prepared = prepare_plan(
            &root,
            Plan {
                project_id: "project".into(),
                clips: vec![clip, reverse, overlap],
                duration: 4.,
            },
            &emit,
            &cancel,
        )
        .unwrap();
        assert_eq!(prepared.samples.len(), 4 * RATE);
        assert_eq!(prepared.samples[RATE / 2], 0.);
        assert!((prepared.samples[RATE + RATE / 2] - 0.4).abs() < 1e-6);
        assert_eq!(prepared.samples[2 * RATE + RATE / 2], 0.);
        assert!(prepared.samples[3 * RATE] > 0.99);
        assert!(prepared.samples[4 * RATE - 1] < 0.001);
        assert_eq!(fs::read(&source).unwrap(), b"original source bytes");
        fs::remove_dir_all(root).unwrap();
    }
}
