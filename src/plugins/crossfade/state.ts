// Shared fade state so other audio plugins (e.g. skip-silences) can tell an
// intentional crossfade ramp apart from genuine silence in the track.
let fading = false;

export const setCrossfading = (value: boolean) => {
  fading = value;
};

export const isCrossfading = () => fading;
