//! A shared lease prevents Studio, CLI and agent processes oversubscribing speech.
use crate::{Cancel, Emit, check_cancel};
use anyhow::Result;
use serde_json::json;
use std::{
    fs::{File, OpenOptions},
    path::Path,
    time::Duration,
};
pub struct Lease(File);
impl Drop for Lease {
    fn drop(&mut self) {
        let _ = fs2::FileExt::unlock(&self.0);
    }
}
pub fn acquire(root: &Path, emit: &Emit, cancel: &Cancel) -> Result<Lease> {
    check_cancel(cancel)?;
    std::fs::create_dir_all(root)?;
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .read(true)
        .write(true)
        .open(root.join("speech-inference.lock"))?;
    let mut reported = false;
    loop {
        check_cancel(cancel)?;
        match fs2::FileExt::try_lock_exclusive(&file) {
            Ok(()) => return Ok(Lease(file)),
            Err(error)
                if error.kind() == std::io::ErrorKind::WouldBlock
                    || error.raw_os_error() == fs2::lock_contended_error().raw_os_error() =>
            {
                if !reported {
                    emit(
                        "progress",
                        json!({"stage":"queued","message":"Waiting for another local speech job to release its resource budget"}),
                    );
                    reported = true;
                }
                std::thread::sleep(Duration::from_millis(40));
            }
            Err(error) => return Err(error.into()),
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, atomic::AtomicBool};
    #[test]
    fn independent_clients_share_and_release_the_same_lease() {
        let root = std::env::temp_dir().join(format!("aiditor-lease-{}", uuid::Uuid::new_v4()));
        let emit: Emit = Arc::new(|_, _| {});
        let cancel = Arc::new(AtomicBool::new(false));
        let lease = acquire(&root, &emit, &cancel).unwrap();
        let other = OpenOptions::new()
            .read(true)
            .write(true)
            .open(root.join("speech-inference.lock"))
            .unwrap();
        assert!(fs2::FileExt::try_lock_exclusive(&other).is_err());
        drop(lease);
        fs2::FileExt::try_lock_exclusive(&other).unwrap();
        fs2::FileExt::unlock(&other).unwrap();
        drop(other);
        assert!(acquire(&root, &emit, &Arc::new(AtomicBool::new(true))).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn queued_clients_can_cancel_without_interrupting_the_owner() {
        let root = std::env::temp_dir().join(format!("aiditor-queued-{}", uuid::Uuid::new_v4()));
        let cancel = Arc::new(AtomicBool::new(false));
        let owner_cancel = Arc::new(AtomicBool::new(false));
        let owner_emit: Emit = Arc::new(|_, _| {});
        let lease = acquire(&root, &owner_emit, &owner_cancel).unwrap();
        let (sender, receiver) = std::sync::mpsc::channel();
        let worker_root = root.clone();
        let worker_cancel = cancel.clone();
        let worker = std::thread::spawn(move || {
            let emit: Emit = Arc::new(move |_, value| {
                let _ = sender.send(value);
            });
            acquire(&worker_root, &emit, &worker_cancel).is_err()
        });
        assert_eq!(
            receiver.recv_timeout(Duration::from_secs(3)).unwrap()["stage"],
            "queued"
        );
        cancel.store(true, std::sync::atomic::Ordering::Relaxed);
        assert!(worker.join().unwrap());
        assert!(!owner_cancel.load(std::sync::atomic::Ordering::Relaxed));
        drop(lease);
        std::fs::remove_dir_all(root).unwrap();
    }
}
