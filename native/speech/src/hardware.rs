//! Driver API probes. Presence is a candidate; successful inference is still required.
use ash::vk;
use serde_json::{Value, json};
use std::ffi::{CStr, c_char, c_int};

fn cuda() -> anyhow::Result<Value> {
    #[cfg(windows)]
    let name = std::path::PathBuf::from(
        std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into()),
    )
    .join("System32/nvcuda.dll");
    #[cfg(not(windows))]
    let name = std::path::PathBuf::from("libcuda.so.1");
    unsafe {
        let library = libloading::Library::new(name)?;
        let init = library.get::<unsafe extern "system" fn(u32) -> c_int>(b"cuInit\0")?;
        let count =
            library.get::<unsafe extern "system" fn(*mut c_int) -> c_int>(b"cuDeviceGetCount\0")?;
        let get_name = library
            .get::<unsafe extern "system" fn(*mut c_char, c_int, c_int) -> c_int>(
                b"cuDeviceGetName\0",
            )?;
        let attribute = library
            .get::<unsafe extern "system" fn(*mut c_int, c_int, c_int) -> c_int>(
                b"cuDeviceGetAttribute\0",
            )?;
        let memory = library.get::<unsafe extern "system" fn(*mut usize, c_int) -> c_int>(
            b"cuDeviceTotalMem_v2\0",
        )?;
        let version = library
            .get::<unsafe extern "system" fn(*mut c_int) -> c_int>(b"cuDriverGetVersion\0")?;
        let mut devices = 0;
        if init(0) != 0 || count(&mut devices) != 0 {
            anyhow::bail!("CUDA driver initialization failed");
        }
        let mut driver = 0;
        version(&mut driver);
        let mut result = vec![];
        for index in 0..devices.clamp(0, 64) {
            let mut name = [0 as c_char; 256];
            let (mut major, mut minor, mut bytes) = (0, 0, 0);
            if get_name(name.as_mut_ptr(), 256, index) != 0
                || attribute(&mut major, 75, index) != 0
                || attribute(&mut minor, 76, index) != 0
                || memory(&mut bytes, index) != 0
            {
                continue;
            }
            result.push(
                json!({"index":index,"name":CStr::from_ptr(name.as_ptr()).to_string_lossy(),
                "computeMajor":major,"computeMinor":minor,"totalMemoryBytes":bytes}),
            );
        }
        Ok(json!({"driverVersion":driver,"devices":result}))
    }
}
fn vulkan() -> anyhow::Result<Value> {
    unsafe {
        let entry = ash::Entry::load()?;
        let app = vk::ApplicationInfo::default().api_version(vk::API_VERSION_1_0);
        let info = vk::InstanceCreateInfo::default().application_info(&app);
        let instance = entry.create_instance(&info, None)?;
        let result = (|| -> anyhow::Result<Value> {
            let mut devices = vec![];
            for device in instance.enumerate_physical_devices()? {
                let props = instance.get_physical_device_properties(device);
                let compute = instance
                    .get_physical_device_queue_family_properties(device)
                    .iter()
                    .any(|q| q.queue_count > 0 && q.queue_flags.contains(vk::QueueFlags::COMPUTE));
                if !compute || props.device_type == vk::PhysicalDeviceType::CPU {
                    continue;
                }
                let memory = instance.get_physical_device_memory_properties(device);
                let bytes: u64 = memory.memory_heaps[..memory.memory_heap_count as usize]
                    .iter()
                    .filter(|h| h.flags.contains(vk::MemoryHeapFlags::DEVICE_LOCAL))
                    .map(|h| h.size)
                    .sum();
                devices.push(json!({"name":CStr::from_ptr(props.device_name.as_ptr()).to_string_lossy(),
                    "vendorId":props.vendor_id,"deviceId":props.device_id,"driverVersion":props.driver_version,
                    "apiVersion":props.api_version,"deviceLocalMemoryBytes":bytes}));
            }
            Ok(json!({"devices":devices}))
        })();
        instance.destroy_instance(None);
        result
    }
}
fn metal() -> bool {
    #[cfg(target_os = "macos")]
    {
        #[link(name = "Metal", kind = "framework")]
        unsafe extern "C" {
            fn MTLCreateSystemDefaultDevice() -> *mut std::ffi::c_void;
        }
        #[link(name = "objc")]
        unsafe extern "C" {
            fn objc_release(object: *mut std::ffi::c_void);
        }
        unsafe {
            let device = MTLCreateSystemDefaultDevice();
            if !device.is_null() {
                objc_release(device);
                return true;
            }
        }
    }
    false
}
pub fn platform() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}
pub fn detect() -> Value {
    let cuda = cuda().unwrap_or_else(|e| json!({"devices":[],"reason":e.to_string()}));
    let vulkan = vulkan().unwrap_or_else(|e| json!({"devices":[],"reason":e.to_string()}));
    let metal = metal();
    let nvidia = cuda["devices"]
        .as_array()
        .and_then(|a| a.first())
        .map(|d| d["name"].clone());
    let vk = vulkan["devices"].as_array().is_some_and(|a| !a.is_empty());
    let cpu = crate::cpu::topology();
    json!({"platform":format!("{}-{}",std::env::consts::OS,std::env::consts::ARCH),
        "nvidia":nvidia,"cuda":cuda,"vulkan":vulkan,"metal":metal,"vulkanLoader":vk,
        "backendPreference":if nvidia.is_some(){"cuda"}else if metal{"metal"}else if vk{"vulkan"}else{"cpu"},
        "cpuThreads":cpu.available_cpus,"captionThreads":crate::cpu::inference_threads(),"cpu":cpu,
        "qualification":"Driver probe only; backend and model initialization must also succeed."})
}
