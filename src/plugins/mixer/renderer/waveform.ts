export const computePeaks = (
  samples: Float32Array,
  buckets: number,
): Float32Array => {
  const safeBuckets = Number.isFinite(buckets) ? buckets : 1;
  const count = Math.max(1, Math.floor(safeBuckets));
  const peaks = new Float32Array(count);

  if (samples.length === 0) return peaks;

  const bucketSize = samples.length / count;

  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor(bucket * bucketSize);
    const end = Math.min(
      samples.length,
      Math.max(start + 1, Math.floor((bucket + 1) * bucketSize)),
    );

    let peak = 0;

    for (let index = start; index < end; index += 1) {
      const amplitude = Math.abs(samples[index]);
      if (amplitude > peak) peak = amplitude;
    }

    peaks[bucket] = Math.min(1, peak);
  }

  return peaks;
};

export const bufferPeaks = (
  buffer: AudioBuffer,
  buckets: number,
): Float32Array => computePeaks(buffer.getChannelData(0), buckets);
