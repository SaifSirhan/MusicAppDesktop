export type FakeParam = {
  value: number;
  setValueAtTime: (value: number, time: number) => void;
  setTargetAtTime: (value: number, time: number, constant: number) => void;
};

export const fakeParam = (initial: number): FakeParam => {
  const param: FakeParam = {
    value: initial,
    setValueAtTime: (value: number, _time: number) => {
      param.value = value;
    },
    setTargetAtTime: (value: number, _time: number, _constant: number) => {
      param.value = value;
    },
  };

  return param;
};

export class FakeNode {
  connected: FakeNode[] = [];

  connect(destination: FakeNode): FakeNode {
    this.connected.push(destination);

    return destination;
  }

  disconnect(): void {
    this.connected = [];
  }
}

export class FakeGain extends FakeNode {
  gain: FakeParam = fakeParam(1);
}

export class FakeSource extends FakeNode {
  buffer: AudioBuffer | null = null;
  playbackRate: FakeParam = fakeParam(1);
  onended: (() => void) | null = null;
  started: { offset: number } | null = null;
  stopped = false;

  start(_when = 0, offset = 0): void {
    this.started = { offset };
  }

  stop(): void {
    this.stopped = true;
  }
}

export class FakeContext {
  currentTime = 0;
  state = 'running';
  destination = new FakeNode();
  createdSources: FakeSource[] = [];
  createdGains: FakeGain[] = [];

  createGain(): FakeGain {
    const gain = new FakeGain();
    this.createdGains.push(gain);

    return gain;
  }

  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.createdSources.push(source);

    return source;
  }

  resume(): Promise<void> {
    this.state = 'running';

    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.state = 'suspended';

    return Promise.resolve();
  }

  close(): Promise<void> {
    this.state = 'closed';

    return Promise.resolve();
  }
}

export const fakeBuffer = (duration: number): AudioBuffer =>
  ({
    duration,
    getChannelData: () => new Float32Array(0),
  }) as unknown as AudioBuffer;
