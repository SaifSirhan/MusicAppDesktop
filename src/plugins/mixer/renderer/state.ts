import type { DeckId, MixerEngine } from './engine';

export type MixerSnapshot = {
  crossfader: number;
  masterVolume: number;
  decks: Record<
    DeckId,
    {
      status: string;
      duration: number;
      position: number;
      rate: number;
      volume: number;
    }
  >;
};

type SnapshotSource = Pick<
  MixerEngine,
  'getCrossfader' | 'getMasterVolume' | 'decks'
>;

export const toSnapshot = (engine: SnapshotSource): MixerSnapshot => ({
  crossfader: engine.getCrossfader(),
  masterVolume: engine.getMasterVolume(),
  decks: {
    A: {
      status: engine.decks.A.getCore().status,
      duration: engine.decks.A.getDuration(),
      position: engine.decks.A.position(),
      rate: engine.decks.A.getRate(),
      volume: engine.decks.A.getVolume(),
    },
    B: {
      status: engine.decks.B.getCore().status,
      duration: engine.decks.B.getDuration(),
      position: engine.decks.B.position(),
      rate: engine.decks.B.getRate(),
      volume: engine.decks.B.getVolume(),
    },
  },
});

type MixerHook = { snapshot: () => MixerSnapshot };
type MixerWindow = { __mixer?: MixerHook };

export const installDevHook = (engine: SnapshotSource): (() => void) => {
  const target = window as unknown as MixerWindow;
  target.__mixer = { snapshot: () => toSnapshot(engine) };

  return () => {
    delete target.__mixer;
  };
};
