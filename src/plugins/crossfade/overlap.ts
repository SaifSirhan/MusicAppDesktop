import {
  initialOverlap,
  reduceOverlap,
  type OverlapDeckId,
  type OverlapEffect,
  type OverlapEvent,
  type OverlapMachine,
} from './overlap-machine';
import { setCrossfading, setOverlapActive } from './state';

import {
  crossfaderGains,
  MixerEngine,
  type DeckCore,
} from '../mixer/renderer/engine';
import { loadTrack, type MixerQueueItem } from '../mixer/renderer/session';

import type { MixerClient } from '../mixer/renderer/client';
import type { CrossfadePluginConfig } from './index';
import type { MusicPlayer } from '@/types/music-player';

type OverlapConfig = CrossfadePluginConfig & { overlap?: boolean };

export type OverlapControllerOptions = {
  client: MixerClient;
  readQueue: () => MixerQueueItem[];
  getConfig: () => OverlapConfig;
  createEngine?: () => MixerEngine;
  decode?: (context: AudioContext, data: ArrayBuffer) => Promise<AudioBuffer>;
  now?: () => number;
  requestFrame?: (callback: () => void) => number;
  cancelFrame?: (handle: number) => void;
  advance?: (ms: number) => void;
  flushFrames?: () => void;
};

export type OverlapSnapshot = {
  state: OverlapMachine['phase'];
  activeDeck: OverlapDeckId | null;
  videoId: string | null;
  position: number;
  volume: number;
  ytmMuted: boolean;
};

const MIN_BLEND_SECONDS = 1;
const ADVANCE_DEBOUNCE_MS = 300;
const ARM_LEAD_SECONDS = 45;

export type OverlapController = ReturnType<typeof createOverlapController>;

export const createOverlapController = (options: OverlapControllerOptions) => {
  const now = options.now ?? (() => performance.now());
  const requestFrame =
    options.requestFrame ??
    ((callback: () => void) => window.requestAnimationFrame(callback));
  const cancelFrame =
    options.cancelFrame ??
    ((handle: number) => window.cancelAnimationFrame(handle));
  const decode =
    options.decode ??
    ((context: AudioContext, data: ArrayBuffer) =>
      context.decodeAudioData(data.slice(0)));

  let machine = initialOverlap();
  let engine: MixerEngine | null = null;
  let video: HTMLVideoElement | null = null;
  let playerApi: MusicPlayer | null = null;
  let config = options.getConfig();
  let master = 1;
  let rampToken = 0;
  let rampFrame = 0;
  let arming = false;
  let suspended = false;
  let lastAdvanceAt = -Infinity;
  let loadedPaths: Partial<Record<OverlapDeckId, string>> = {};
  let failedTrackId: string | null = null;
  const detachers: Array<() => void> = [];
  let tickTimer: number | null = null;
  let syncTimer: number | null = null;

  const videoId = (): string | null =>
    playerApi?.getVideoData()?.video_id ??
    (typeof location === 'undefined'
      ? null
      : new URLSearchParams(location.search).get('v'));

  const deck = (id: OverlapDeckId) => engine?.decks[id] ?? null;

  const ensureEngine = (): MixerEngine => {
    if (engine) return engine;

    engine = options.createEngine ? options.createEngine() : new MixerEngine();
    engine.setMasterVolume(video?.volume ?? master);
    engine.decks.A.subscribe(onDeckCore);
    engine.decks.B.subscribe(onDeckCore);

    return engine;
  };

  const syncPins = () => {
    const paths = [
      machine.activeDeck ? loadedPaths[machine.activeDeck] : undefined,
      machine.incomingDeck ? loadedPaths[machine.incomingDeck] : undefined,
    ].filter((path, index, all): path is string =>
      Boolean(path) && all.indexOf(path) === index,
    );

    options.client.setPinnedTracks(paths).catch(() => {});
  };

  const stopDecks = () => {
    // dispose() disconnects the deck gains permanently, so a reused engine
    // would be silent. Drop it and let the next arm build a fresh context.
    engine?.close().catch(() => {});
    engine = null;
    loadedPaths = {};
    setOverlapActive(false);
    setCrossfading(false);
  };

  const cancelRamp = () => {
    rampToken += 1;
    if (rampFrame) cancelFrame(rampFrame);
    rampFrame = 0;
  };

  const guardedAdvance = () => {
    if (now() - lastAdvanceAt < ADVANCE_DEBOUNCE_MS) return;
    if (videoId() !== machine.activeTrackId) return;
    if (typeof document === 'undefined') return;

    lastAdvanceAt = now();
    document.querySelector<HTMLButtonElement>('.next-button')?.click();
  };

  const applyEffects = (effects: OverlapEffect[]) => {
    for (const effect of effects) {
      switch (effect) {
        case 'mute-ytm':
          if (video) video.muted = true;
          break;
        case 'seek-ytm': {
          const active = machine.activeDeck ? deck(machine.activeDeck) : null;
          if (active && playerApi) playerApi.seekTo(active.position());
          break;
        }
        case 'unmute-ytm':
          if (video) {
            video.muted = false;
            video.volume = master;
          }
          break;
        case 'advance-ytm':
          guardedAdvance();
          break;
        case 'stop-decks':
          cancelRamp();
          stopDecks();
          break;
        case 'pin-tracks':
          syncPins();
          break;
        case 'start-ramp':
          break;
      }
    }

    setOverlapActive(machine.phase !== 'idle');
  };

  const dispatch = (event: OverlapEvent) => {
    const previous = machine;
    const result = reduceOverlap(machine, event);
    machine = result.state;
    applyEffects(result.effects);

    if (result.effects.includes('start-ramp')) {
      startRamp(previous.phase === 'owned' ? previous.activeDeck : null);
    }
  };

  const blendSeconds = (): number => {
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return 0;
    }

    const configured = Math.min(
      config.secondsBeforeEnd,
      config.fadeOutDuration / 1000,
      video.duration / 2,
    );

    return configured >= MIN_BLEND_SECONDS ? configured : 0;
  };

  const remaining = (): number | null => {
    if (machine.phase === 'owned' || machine.phase === 'blending') {
      const active = machine.activeDeck ? deck(machine.activeDeck) : null;
      if (!active || active.getDuration() === 0) return null;

      return active.getDuration() - active.position();
    }

    if (!video || !Number.isFinite(video.duration)) return null;

    return video.duration - video.currentTime;
  };

  const otherDeck = (): OverlapDeckId =>
    machine.activeDeck === 'A' || machine.incomingDeck === 'A' ? 'B' : 'A';

  const armNext = async () => {
    if (arming || suspended) return;

    const items = options.readQueue();
    const index = items.findIndex(
      (entry) => entry.videoId === machine.activeTrackId,
    );
    const next = index >= 0 ? items[index + 1] : undefined;

    if (!next || next.videoId === machine.activeTrackId) return;
    if (failedTrackId === next.videoId) return;

    arming = true;

    try {
      const target = ensureEngine();
      const deckId = otherDeck();
      const path = await loadTrack(
        {
          client: options.client,
          decode: (data) => decode(target.context, data),
        },
        target.decks[deckId],
        next,
      );

      if (!path) {
        failedTrackId = next.videoId;

        return;
      }

      if (videoId() !== machine.activeTrackId) return;

      loadedPaths[deckId] = path;
      dispatch({ type: 'armed', deck: deckId, trackId: next.videoId });
      syncPins();
    } finally {
      arming = false;
    }
  };

  const playIncoming = (incoming: OverlapDeckId) => {
    engine?.decks[incoming].play().then((started) => {
      if (!started) abortOwnership();
    });
  };

  const startRamp = (fromDeck: OverlapDeckId | null) => {
    if (!video || !engine || !machine.incomingDeck) return;

    const incoming = machine.incomingDeck;
    const elapsedSeconds = Math.max(MIN_BLEND_SECONDS, blendSeconds());
    const durationMs = elapsedSeconds * 1000;
    const started = now();
    const token = ++rampToken;
    const outgoingIsYtm = machine.phase === 'blending' && fromDeck === null;

    master = video.volume || master;
    engine.setMasterVolume(master);
    setCrossfading(true);

    if (outgoingIsYtm) {
      engine.setCrossfader(incoming === 'A' ? -1 : 1);
      engine.decks[incoming].setVolume(0);
      playIncoming(incoming);
    } else {
      engine.decks.A.setVolume(1);
      engine.decks.B.setVolume(1);
      playIncoming(incoming);
    }

    const step = () => {
      if (token !== rampToken || !video || !engine) return;

      const p = Math.min(1, (now() - started) / durationMs);

      if (outgoingIsYtm) {
        const gains = crossfaderGains(-1 + (p * 2));
        video.volume = master * gains.a;
        engine.decks[incoming].setVolume(gains.b);
      } else if (fromDeck === 'A') {
        engine.setCrossfader(-1 + (p * 2));
      } else {
        engine.setCrossfader(1 - (p * 2));
      }

      if (p < 1) {
        rampFrame = requestFrame(step);

        return;
      }

      if (outgoingIsYtm) {
        engine.decks[incoming].setVolume(1);
        video.volume = video.muted ? master : 0;
      } else {
        engine.setCrossfader(incoming === 'A' ? -1 : 1);
      }

      setCrossfading(false);
      dispatch({ type: 'ramp-done' });
    };

    step();
  };

  const abortOwnership = () => {
    cancelRamp();
    dispatch({ type: 'abort' });
    setCrossfading(false);
  };

  const onDeckCore = (core: DeckCore) => {
    if (core.status === 'ended' && machine.phase !== 'idle') {
      dispatch({ type: 'deck-ended' });
    }
  };

  const onTick = async () => {
    if (suspended || !video || !playerApi) return;

    if (
      (machine.phase === 'owned' || machine.phase === 'blending') &&
      engine?.context.state === 'suspended'
    ) {
      const resumed = await engine.resume();
      if (!resumed) abortOwnership();

      return;
    }

    const windowSeconds = blendSeconds();
    if (windowSeconds <= 0) return;

    if (machine.phase === 'blending') return;

    const left = remaining();
    if (left === null) return;

    if (
      machine.incomingDeck === null &&
      (machine.phase === 'idle' || machine.phase === 'owned') &&
      left <= windowSeconds + ARM_LEAD_SECONDS
    ) {
      await armNext();
    }

    if (machine.phase === 'arming' && left <= windowSeconds) {
      dispatch({ type: 'blend-start' });
    }

    if (
      machine.phase === 'owned' &&
      machine.incomingDeck !== null &&
      left <= windowSeconds
    ) {
      dispatch({ type: 'next-boundary' });
    }
  };

  const onNavigation = (newVideoId: string) => {
    failedTrackId = null;

    if (machine.phase === 'blending') {
      cancelRamp();
      if (engine) {
        engine.decks.A.setVolume(1);
        engine.decks.B.setVolume(1);
        engine.setCrossfader(machine.incomingDeck === 'A' ? -1 : 1);
      }
      if (video) video.volume = master;
    }

    dispatch({ type: 'navigation', videoId: newVideoId });
  };

  const onSeeked = () => {
    if (!video) return;

    if (machine.phase === 'owned') {
      if (machine.activeDeck) deck(machine.activeDeck)?.seek(video.currentTime);
      return;
    }

    if (machine.phase === 'blending') abortOwnership();
  };

  const onPause = () => {
    if (machine.phase === 'blending') {
      abortOwnership();
      return;
    }

    if (machine.phase === 'owned' && machine.activeDeck) {
      deck(machine.activeDeck)?.pause();
    }
  };

  const onPlay = () => {
    if (machine.phase === 'owned' && machine.activeDeck) {
      deck(machine.activeDeck)?.play().then((started) => {
        if (!started) abortOwnership();
      });
    }
  };

  const onVolume = () => {
    if (!video || machine.phase === 'idle') return;

    if (machine.phase === 'owned' && engine && video.muted) {
      engine.setMasterVolume(video.volume);
    }
  };

  const onRate = () => {
    if (video && video.playbackRate !== 1 && machine.phase !== 'idle') {
      abortOwnership();
    }
  };

  const microSync = () => {
    if (!video || !engine || machine.phase !== 'owned' || video.paused) return;
    if (!machine.activeDeck) return;

    const active = deck(machine.activeDeck);
    if (!active || active.getCore().status !== 'playing') return;

    if (Math.abs(video.currentTime - active.position()) > 0.5) {
      active.seek(video.currentTime);
    }
  };

  const onMixerOpen = () => {
    suspended = true;
    abortOwnership();
  };

  const onMixerClose = () => {
    suspended = false;
  };

  const listen = (target: EventTarget, event: string, handler: () => void) => {
    target.addEventListener(event, handler);
    detachers.push(() => target.removeEventListener(event, handler));
  };

  return {
    start(element: HTMLVideoElement, api: MusicPlayer) {
      video = element;
      playerApi = api;
      master = element.volume || 1;

      listen(element, 'timeupdate', () => {
        onTick().catch(() => {});
      });
      listen(element, 'pause', onPause);
      listen(element, 'play', onPlay);
      listen(element, 'seeked', onSeeked);
      listen(element, 'volumechange', onVolume);
      listen(element, 'ratechange', onRate);

      if (typeof window !== 'undefined') {
        const navigationTarget = window.navigation;
        if (navigationTarget) {
          const onNavigateWindow = (event: Event) => {
            const target = event as unknown as {
              destination?: { url?: string };
            };
            const url = new URL(target.destination?.url ?? location.href);
            const id = url.searchParams.get('v');
            if (id) onNavigation(id);
          };
          navigationTarget.addEventListener('navigate', onNavigateWindow);
          detachers.push(() =>
            navigationTarget.removeEventListener('navigate', onNavigateWindow),
          );
        }

        listen(window, 'musicapp:mixer-open', onMixerOpen);
        listen(window, 'musicapp:mixer-close', onMixerClose);

        tickTimer = window.setInterval(() => {
          onTick().catch(() => {});
        }, 250);
        syncTimer = window.setInterval(microSync, 5000);
      }

      const current = videoId();
      if (current) onNavigation(current);
    },

    stop() {
      cancelRamp();
      abortOwnership();
      options.client.setPinnedTracks([]).catch(() => {});
      for (const off of detachers) off();
      detachers.length = 0;
      if (tickTimer !== null) window.clearInterval(tickTimer);
      if (syncTimer !== null) window.clearInterval(syncTimer);
      tickTimer = null;
      syncTimer = null;
      engine = null;
      video = null;
      playerApi = null;
      setOverlapActive(false);
      setCrossfading(false);
    },

    updateConfig(next: OverlapConfig) {
      config = next;
      if (!next.enabled || !next.overlap) abortOwnership();
    },

    tickForTest() {
      options.advance?.(1000);
      if (video) video.currentTime += 1;

      return onTick();
    },

    navigateForTest(id: string) {
      onNavigation(id);
    },

    snapshot(): OverlapSnapshot {
      const active = machine.activeDeck ? deck(machine.activeDeck) : null;

      return {
        state: machine.phase,
        activeDeck: machine.activeDeck,
        videoId: machine.activeTrackId,
        position: active?.position() ?? 0,
        volume: engine?.getMasterVolume() ?? master,
        ytmMuted: video?.muted ?? false,
      };
    },
  };
};
