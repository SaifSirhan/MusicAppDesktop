import { describe, expect, it, vi } from 'vitest';

import { downloadChunks } from '../../src/providers/download-chunks';

const streamOf = (sizes: number[]) =>
  (async function* () {
    for (const size of sizes) yield new Uint8Array(size);
  })();

describe('downloadChunks', () => {
  it('accepts a complete stream and reports progress', async () => {
    const progress = vi.fn();

    const chunks = await downloadChunks(streamOf([4, 6]), 10, progress);

    expect(chunks.map((chunk) => chunk.length)).toEqual([4, 6]);
    expect(progress).toHaveBeenCalledWith({
      phase: 'downloading',
      ratio: 0.4,
    });
    expect(progress).toHaveBeenLastCalledWith({
      phase: 'downloading',
      ratio: 1,
    });
  });

  it('rejects a stream that ends short of the advertised length', async () => {
    // YouTube closes gated streams early without raising a stream error, so
    // the byte count is the only signal that the download is incomplete.
    await expect(
      downloadChunks(streamOf([4]), 10, vi.fn()),
    ).rejects.toThrow(/incomplete download/i);
  });

  it('accepts a stream when the length is unknown', async () => {
    const chunks = await downloadChunks(streamOf([4]), 0, vi.fn());

    expect(chunks).toHaveLength(1);
  });

  it('accepts a stream longer than the advertised length', async () => {
    const chunks = await downloadChunks(streamOf([8, 8]), 10, vi.fn());

    expect(chunks).toHaveLength(2);
  });
});
