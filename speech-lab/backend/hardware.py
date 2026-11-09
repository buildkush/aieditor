import os
import platform
import shutil
import subprocess
import threading
import time


def nvidia_smi():
    return shutil.which('nvidia-smi')


def gpu_sample():
    executable = nvidia_smi()
    if not executable:
        return None
    flags = {'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {}
    try:
        result = subprocess.run([executable, '--query-gpu=name,utilization.gpu,memory.used,memory.total', '--format=csv,noheader,nounits'],
                                capture_output=True, text=True, timeout=2, **flags)
        if result.returncode:
            return None
        rows = result.stdout.strip().splitlines()
        name, utilization, used, total = [part.strip() for part in rows[0].split(',')]
        return {'name': name, 'utilizationPercent': float(utilization), 'usedMiB': float(used), 'totalMiB': float(total)}
    except (OSError, ValueError, subprocess.SubprocessError):
        return None


def detect():
    import ctranslate2
    import psutil
    count, cuda_types, cuda_error = 0, [], None
    try:
        count = ctranslate2.get_cuda_device_count()
        if count:
            cuda_types = sorted(ctranslate2.get_supported_compute_types('cuda', 0))
    except Exception as exc:
        cuda_error = str(exc)
    return {'cpu': platform.processor() or platform.machine(), 'logicalCpus': os.cpu_count(),
            'ramBytes': psutil.virtual_memory().total, 'cpuComputeTypes': sorted(ctranslate2.get_supported_compute_types('cpu')),
            'cudaDevices': count, 'cudaComputeTypes': cuda_types, 'cudaError': cuda_error, 'gpu': gpu_sample()}


class Metrics:
    def __init__(self):
        import psutil
        self.process = psutil.Process()
        self.start = time.perf_counter()
        times = self.process.cpu_times()
        self.cpu_start = times.user + times.system
        self.peak_ram = 0
        self.gpu_util, self.gpu_memory = [], []
        self.stop_event = threading.Event()
        self.thread = threading.Thread(target=self._monitor, daemon=True)
        self.thread.start()

    def _monitor(self):
        while not self.stop_event.is_set():
            memory = self.process.memory_info()
            self.peak_ram = max(self.peak_ram, memory.rss, getattr(memory, 'peak_wset', 0))
            gpu = gpu_sample()
            if gpu:
                # Device-wide figures, deliberately not presented as process-only VRAM.
                self.gpu_util.append(gpu['utilizationPercent'])
                self.gpu_memory.append(gpu['usedMiB'])
            self.stop_event.wait(0.25)

    def finish(self):
        self.stop_event.set()
        self.thread.join(timeout=3)
        times = self.process.cpu_times()
        wall = max(0.001, time.perf_counter() - self.start)
        return {'peakRamBytes': max(self.peak_ram, self.process.memory_info().rss),
                'cpuPercentMachine': (times.user + times.system - self.cpu_start) / wall / (os.cpu_count() or 1) * 100,
                'gpuPercentDevice': sum(self.gpu_util) / len(self.gpu_util) if self.gpu_util else None,
                'peakVramMiBDevice': max(self.gpu_memory) if self.gpu_memory else None}
