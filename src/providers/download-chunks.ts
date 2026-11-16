import type { TrackProgress } from './track-cache';

export const downloadChunks = async (
  stream: AsyncGenerator<Uint8Array, void>,
  contentLength: number,
  onProgress: (progress: TrackProgress) => void,
) => {
  const chunks = [];
  let downloaded = 0;
  for await (const chunk of stream) {
    downloaded += chunk.length;
    chunks.push(chunk);
    const ratio = contentLength > 0 ? downloaded / contentLength : 0;
    onProgress({ phase: 'downloading', ratio });
  }

  // YouTube closes gated streams early without raising a stream error, so the
  // byte count is the only signal that the download is incomplete. Converting
  // a partial input succeeds in ffmpeg, which would cache an undecodable file.
  if (contentLength > 0 && downloaded < contentLength) {
    throw new Error(
      `Incomplete download: received ${downloaded} of ${contentLength} bytes`,
    );
  }

  return chunks;
};
