//! Bound chunk concurrency by physical cores and available memory, not SMT count.
use crate::cpu::Topology;
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub workers: usize,
    pub threads_per_worker: usize,
    pub core_budget: usize,
    pub memory_limited: bool,
}
pub fn plan(cpu: &Topology, chunks: usize, shared_bytes: u64, worker_bytes: u64) -> Schedule {
    let cores = cpu.core_budget.max(1);
    let desired = if cores >= 4 { (cores / 4).max(2) } else { 1 };
    let usable = cpu.available_memory_bytes.saturating_mul(3) / 4;
    let memory_workers = if worker_bytes == 0 || cpu.available_memory_bytes == 0 {
        1
    } else {
        (usable.saturating_sub(shared_bytes) / worker_bytes).max(1) as usize
    };
    let unconstrained = desired.min(chunks.max(1)).min(cores);
    let workers = unconstrained.min(memory_workers).max(1);
    Schedule {
        workers,
        threads_per_worker: (cores / workers).max(1),
        core_budget: cores,
        memory_limited: workers < unconstrained,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn cpu(cores: usize, gb: u64) -> Topology {
        Topology {
            physical_cores: cores,
            logical_cpus: cores * 2,
            available_cpus: cores * 2,
            core_budget: cores,
            total_memory_bytes: gb << 30,
            available_memory_bytes: gb << 30,
            instructions: vec![],
        }
    }
    #[test]
    fn budgets_scale_without_oversubscription() {
        for cores in [1, 2, 4, 8, 16, 32, 64] {
            for chunks in [0, 1, 2, 3, 40] {
                let s = plan(&cpu(cores, 128), chunks, 2 << 30, 1 << 30);
                assert!(s.workers <= chunks.max(1));
                assert!(s.workers * s.threads_per_worker <= cores);
            }
        }
        let s = plan(&cpu(4, 16), 4, 2 << 30, 1 << 30);
        assert_eq!((s.workers, s.threads_per_worker), (2, 2));
        let s = plan(&cpu(16, 32), 8, 2 << 30, 1 << 30);
        assert_eq!((s.workers, s.threads_per_worker), (4, 4));
    }
    #[test]
    fn memory_and_single_chunk_limit_parallelism() {
        assert_eq!(plan(&cpu(16, 32), 1, 2 << 30, 1 << 30).workers, 1);
        let s = plan(&cpu(16, 4), 8, 2 << 30, 1 << 30);
        assert_eq!(s.workers, 1);
        assert!(s.memory_limited);
    }
}
