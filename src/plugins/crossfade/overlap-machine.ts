export type OverlapDeckId = 'A' | 'B';

export type OverlapPhase = 'idle' | 'arming' | 'blending' | 'owned';

export type OverlapMachine = {
  phase: OverlapPhase;
  activeDeck: OverlapDeckId | null;
  incomingDeck: OverlapDeckId | null;
  ytmTrackId: string | null;
  activeTrackId: string | null;
  incomingTrackId: string | null;
};

export type OverlapEvent =
  | { type: 'armed'; deck: OverlapDeckId; trackId: string }
  | { type: 'blend-start' }
  | { type: 'ramp-done' }
  | { type: 'next-boundary' }
  | { type: 'navigation'; videoId: string }
  | { type: 'deck-ended' }
  | { type: 'abort' };

export type OverlapEffect =
  | 'start-ramp'
  | 'mute-ytm'
  | 'seek-ytm'
  | 'unmute-ytm'
  | 'advance-ytm'
  | 'stop-decks'
  | 'pin-tracks';

export const initialOverlap = (): OverlapMachine => ({
  phase: 'idle',
  activeDeck: null,
  incomingDeck: null,
  ytmTrackId: null,
  activeTrackId: null,
  incomingTrackId: null,
});

const idleOn = (videoId?: string): OverlapMachine => ({
  ...initialOverlap(),
  ytmTrackId: videoId ?? null,
  activeTrackId: videoId ?? null,
});

export const reduceOverlap = (
  state: OverlapMachine,
  event: OverlapEvent,
): { state: OverlapMachine; effects: OverlapEffect[] } => {
  switch (event.type) {
    case 'armed': {
      if (state.phase === 'blending') return { state, effects: [] };

      return {
        state: {
          ...state,
          phase: state.phase === 'idle' ? 'arming' : state.phase,
          incomingDeck: event.deck,
          incomingTrackId: event.trackId,
        },
        effects: [],
      };
    }
    case 'blend-start': {
      if (state.phase !== 'arming') return { state, effects: [] };

      return {
        state: { ...state, phase: 'blending' },
        effects: ['start-ramp'],
      };
    }
    case 'next-boundary': {
      if (state.phase !== 'owned' || !state.incomingDeck) {
        return { state, effects: [] };
      }

      return {
        state: { ...state, phase: 'blending' },
        effects: ['start-ramp'],
      };
    }
    case 'ramp-done': {
      if (state.phase !== 'blending' || !state.incomingDeck) {
        return { state, effects: [] };
      }

      return {
        state: {
          ...state,
          phase: 'owned',
          activeDeck: state.incomingDeck,
          activeTrackId: state.incomingTrackId,
          incomingDeck: null,
          incomingTrackId: null,
        },
        effects: ['pin-tracks'],
      };
    }
    case 'navigation': {
      if (state.phase === 'idle') {
        return { state: idleOn(event.videoId), effects: [] };
      }

      if (event.videoId === state.activeTrackId) {
        return {
          state:
            state.ytmTrackId === event.videoId
              ? state
              : { ...state, ytmTrackId: event.videoId },
          effects: state.phase === 'owned' ? ['seek-ytm'] : [],
        };
      }

      if (event.videoId === state.incomingTrackId) {
        return {
          state: {
            ...state,
            phase: 'owned',
            activeDeck: state.incomingDeck,
            activeTrackId: event.videoId,
            incomingDeck: null,
            incomingTrackId: null,
            ytmTrackId: event.videoId,
          },
          effects: ['mute-ytm', 'seek-ytm', 'pin-tracks'],
        };
      }

      return {
        state: idleOn(event.videoId),
        effects: ['stop-decks', 'unmute-ytm', 'pin-tracks'],
      };
    }
    case 'deck-ended': {
      return {
        state,
        effects: state.phase === 'owned' ? ['advance-ytm'] : [],
      };
    }
    case 'abort': {
      if (state.phase === 'idle') return { state, effects: [] };

      return {
        state: idleOn(state.ytmTrackId ?? undefined),
        effects: ['stop-decks', 'unmute-ytm', 'pin-tracks'],
      };
    }
  }
};
