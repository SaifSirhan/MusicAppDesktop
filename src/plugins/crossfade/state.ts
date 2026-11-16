// Shared fade state so other audio plugins (e.g. skip-silences) can tell an
// intentional crossfade ramp apart from genuine silence in the track.
let fading = false;

export const setCrossfading = (value: boolean) => {
  fading = value;
};

export const isCrossfading = () => fading;

// Set while a deck owns playback, so the legacy fade path and other audio
// plugins leave the volume and the transport alone.
let overlapActive = false;

export const setOverlapActive = (value: boolean) => {
  overlapActive = value;
};

export const isOverlapActive = () => overlapActive;
