import { t } from '@/i18n';
import { createPlugin } from '@/utils';

import { VolumeFader } from './fader';

export type CrossfadePluginConfig = {
  enabled: boolean;
  fadeInDuration: number;
  fadeOutDuration: number;
  secondsBeforeEnd: number;
  fadeScaling: 'linear' | 'logarithmic' | number;
};

const MIN_FADE_DURATION = 200;

export default createPlugin<
  unknown,
  unknown,
  {
    config?: CrossfadePluginConfig;
  },
  CrossfadePluginConfig
>({
  name: () => t('plugins.crossfade.name'),
  description: () => t('plugins.crossfade.description'),
  restartNeeded: true,
  config: {
    enabled: false,
    /**
     * The duration of the fade in and fade out in milliseconds.
     *
     * @default 1500ms
     */
    fadeInDuration: 1500,
    /**
     * The duration of the fade in and fade out in milliseconds.
     *
     * @default 5000ms
     */
    fadeOutDuration: 5000,
    /**
     * The duration of the fade in and fade out in seconds.
     *
     * @default 10s
     */
    secondsBeforeEnd: 10,
    /**
     * The scaling algorithm to use for the fade.
     * (or a positive number in dB)
     *
     * @default 'linear'
     */
    fadeScaling: 'linear',
  },
  renderer: {
    async start({ getConfig }) {
      this.config = await getConfig();
    },
    onConfigChange(newConfig) {
      this.config = newConfig;
    },
    onPlayerApiReady() {
      const video = document.querySelector('video');
      if (!video) return;

      let targetVolume = video.volume || 1;
      let fadingOutFor: string | undefined;

      const getVideoID = (url: string) =>
        new URLSearchParams(url.split('?').at(-1)).get('v');

      const createFader = (duration: number) =>
        new VolumeFader(video, {
          fadeScaling: this.config?.fadeScaling,
          fadeDuration: Math.max(MIN_FADE_DURATION, duration),
        });

      // YouTube only exposes direct audio URLs for the first ~1 MB of a
      // track now, so a second overlapping stream cannot be loaded. Transition
      // by fading the current track out, skipping, then fading the next in.
      const fadeIn = () => {
        const volume = Math.max(0.01, targetVolume);
        video.volume = 0;
        createFader(this.config?.fadeInDuration ?? 0).fadeTo(volume);
      };

      window.navigation.addEventListener('navigate', (event) => {
        const previousID = getVideoID(
          (event.currentTarget as Navigation).currentEntry?.url ?? '',
        );
        const nextID = getVideoID(event.destination.url ?? '');

        if (!nextID || nextID === previousID) return;

        fadingOutFor = undefined;
        fadeIn();
      });

      video.addEventListener('timeupdate', () => {
        const secondsBeforeEnd = this.config?.secondsBeforeEnd ?? 0;
        if (!video.duration || video.paused || secondsBeforeEnd <= 0) return;

        const remaining = video.duration - video.currentTime;
        if (remaining > secondsBeforeEnd) return;

        const videoID = getVideoID(location.href);
        if (!videoID || fadingOutFor === videoID) return;
        fadingOutFor = videoID;

        targetVolume = video.volume || targetVolume;

        // Finish the fade right as the track ends so the skip is seamless.
        const fadeDuration = Math.min(
          this.config?.fadeOutDuration ?? 0,
          remaining * 1000,
        );

        createFader(fadeDuration).fadeOut(() => {
          document.querySelector<HTMLButtonElement>('.next-button')?.click();
        });
      });
    },
  },
});
