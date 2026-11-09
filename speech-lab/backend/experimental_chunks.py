"""Pause-aware input boundaries only. Never remove, overlap or filter samples."""
def audio_chunks(samples, sample_rate=16000, maximum_seconds=30, search_seconds=5):
    import numpy as np
    maximum = int(maximum_seconds * sample_rate)
    window = max(1, sample_rate // 10)
    start = 0
    while start < len(samples):
        end = min(start + maximum, len(samples))
        if end < len(samples):
            left = max(start + window, end - int(search_seconds * sample_rate))
            region = samples[left:end]
            count = len(region) // window
            if count:
                energy = np.mean(np.square(region[:count * window].reshape(count, window), dtype=np.float64), axis=1)
                # In flat/silent audio prefer the latest boundary, avoiding tiny tails.
                index = count - 1 - int(np.argmin(energy[::-1]))
                end = left + (index + 1) * window
        yield start, end, samples[start:end]
        start = end
