export const computePeaks = (
  samples: Float32Array,
  buckets: number,
): Float32Array => {
  const safeBuckets = Number.isFinite(buckets) ? buckets : 1;
  const requested = Math.max(1, Math.floor(safeBuckets));
  const peaks = new Float32Array(requested);

  if (samples.length === 0) return peaks;

  // More buckets than samples would leave the tail reading past the end as
  // silence, so every bucket maps to at least one real sample.
  const count = Math.min(requested, samples.length);
  const bucketSize = samples.length / count;

  for (let bucket = 0; bucket < requested; bucket += 1) {
    const source = Math.min(bucket, count - 1);
    const start = Math.floor(source * bucketSize);
    const end = Math.min(
      samples.length,
      Math.max(start + 1, Math.floor((source + 1) * bucketSize)),
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
