//! Conservative CPU inference budget. Logical SMT threads are not extra cores.
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Topology {
    pub physical_cores: usize,
    pub logical_cpus: usize,
    pub available_cpus: usize,
    pub core_budget: usize,
    pub total_memory_bytes: u64,
    pub available_memory_bytes: u64,
    pub instructions: Vec<String>,
}
pub fn topology() -> Topology {
    let logical = num_cpus::get().max(1);
    let available = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(1);
    let physical = physical_cores()
        .unwrap_or_else(num_cpus::get_physical)
        .max(1)
        .min(logical);
    let mut memory = sysinfo::System::new();
    memory.refresh_memory();
    let mut instructions = Vec::new();
    #[cfg(any(target_arch = "x86", target_arch = "x86_64"))]
    for (name, supported) in [
        ("sse4.1", std::is_x86_feature_detected!("sse4.1")),
        ("avx", std::is_x86_feature_detected!("avx")),
        ("avx2", std::is_x86_feature_detected!("avx2")),
        ("fma", std::is_x86_feature_detected!("fma")),
        ("avx512f", std::is_x86_feature_detected!("avx512f")),
        ("avx512bw", std::is_x86_feature_detected!("avx512bw")),
        ("avx512vl", std::is_x86_feature_detected!("avx512vl")),
        ("avx512vnni", std::is_x86_feature_detected!("avx512vnni")),
    ] {
        if supported {
            instructions.push(name.into());
        }
    }
    #[cfg(target_arch = "aarch64")]
    if std::arch::is_aarch64_feature_detected!("neon") {
        instructions.push("neon".into());
    }
    Topology {
        physical_cores: physical,
        logical_cpus: logical,
        available_cpus: available,
        core_budget: physical.min(available),
        total_memory_bytes: memory.total_memory(),
        available_memory_bytes: memory.available_memory(),
        instructions,
    }
}

#[cfg(any(windows, test))]
fn core_records(bytes: &[u8]) -> Option<usize> {
    let (mut offset, mut count) = (0usize, 0usize);
    while offset < bytes.len() {
        let header = bytes.get(offset..offset.checked_add(8)?)?;
        let relationship = u32::from_le_bytes(header[..4].try_into().ok()?);
        let size = u32::from_le_bytes(header[4..].try_into().ok()?) as usize;
        if size < 8 {
            return None;
        }
        offset = offset.checked_add(size)?;
        if offset > bytes.len() {
            return None;
        }
        if relationship == 0 {
            count += 1;
        }
    }
    (count > 0).then_some(count)
}

#[cfg(windows)]
fn physical_cores() -> Option<usize> {
    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn GetLogicalProcessorInformationEx(
            relationship: u32,
            buffer: *mut std::ffi::c_void,
            length: *mut u32,
        ) -> i32;
    }
    let mut length = 0;
    unsafe {
        GetLogicalProcessorInformationEx(0, std::ptr::null_mut(), &mut length);
    }
    if length == 0 || length > 1024 * 1024 {
        return None;
    }
    // Back the variable-sized Windows structures with aligned storage.
    let mut storage = vec![0u64; (length as usize).div_ceil(8)];
    if unsafe { GetLogicalProcessorInformationEx(0, storage.as_mut_ptr().cast(), &mut length) } == 0
    {
        return None;
    }
    let bytes =
        unsafe { std::slice::from_raw_parts(storage.as_ptr().cast::<u8>(), length as usize) };
    core_records(bytes)
}

#[cfg(not(windows))]
fn physical_cores() -> Option<usize> {
    None
}

pub fn inference_threads() -> usize {
    static THREADS: OnceLock<usize> = OnceLock::new();
    *THREADS.get_or_init(|| topology().core_budget.clamp(1, 8))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn counts_core_records_and_rejects_corrupt_sizes() {
        let two = [0u32, 8, 0, 8]
            .into_iter()
            .flat_map(u32::to_le_bytes)
            .collect::<Vec<_>>();
        assert_eq!(core_records(&two), Some(2));
        assert_eq!(core_records(&[0; 8]), None);
        assert_eq!(core_records(&[0; 7]), None);
    }
    #[test]
    fn budget_respects_available_parallelism() {
        assert!((1..=8).contains(&inference_threads()));
        assert!(
            inference_threads()
                <= std::thread::available_parallelism()
                    .map(|n| n.get())
                    .unwrap_or(4)
        );
    }
}
