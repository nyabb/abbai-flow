import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getStoredSound, playSoundOnce, setStoredSound } from './timer-sound';

/**
 * The sound engine is browser-only: it builds an oscillator graph on an
 * `AudioContext`. jsdom has no Web Audio, so the context is faked here — the
 * tests assert that each sound builds the graph it promises, that a browser
 * without Web Audio degrades to silence instead of throwing, and that the
 * preference round-trips.
 */

interface FakeNode {
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  type: string;
  frequency: { value: number; setValueAtTime: ReturnType<typeof vi.fn> };
  gain: {
    value: number;
    setValueAtTime: ReturnType<typeof vi.fn>;
    exponentialRampToValueAtTime: ReturnType<typeof vi.fn>;
  };
}

function makeContext() {
  const oscillators: FakeNode[] = [];
  const gains: FakeNode[] = [];
  const ctx = {
    currentTime: 1,
    destination: {},
    close: vi.fn(),
    createOscillator: vi.fn(() => {
      const node: FakeNode = {
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        type: 'sine',
        frequency: { value: 0, setValueAtTime: vi.fn() },
        gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      };
      oscillators.push(node);
      return node;
    }),
    createGain: vi.fn(() => {
      const node: FakeNode = {
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        type: '',
        frequency: { value: 0, setValueAtTime: vi.fn() },
        gain: { value: 0, setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      };
      gains.push(node);
      return node;
    }),
  };
  return { ctx, oscillators, gains };
}


/**
 * `new AudioContext()` needs a constructible function, not an arrow — an arrow
 * would throw "not a constructor" and the module would swallow it as silence.
 */
function installAudioContext(factory: () => unknown) {
  globalThis.AudioContext = function AudioContextMock() {
    return factory();
  } as unknown as typeof AudioContext;
}

const originalAudioContext = globalThis.AudioContext;

afterEach(() => {
  globalThis.AudioContext = originalAudioContext;
  vi.useRealTimers();
  localStorage.clear();
});

beforeEach(() => {
  localStorage.clear();
});

describe('the stored sound preference', () => {
  it('falls back to a chime when nothing is stored', () => {
    expect(getStoredSound()).toBe('chime');
  });

  it('round-trips a known sound', () => {
    setStoredSound('alarm');
    expect(getStoredSound()).toBe('alarm');
  });

  it('ignores a value it does not recognise', () => {
    localStorage.setItem('beacon-timer-sound', 'airhorn');
    expect(getStoredSound()).toBe('chime');
  });
});

describe('playing a sound', () => {
  it('builds one oscillator per note for the descending chime', () => {
    const fake = makeContext();
    installAudioContext(() => fake.ctx);

    const ctx = playSoundOnce('chime');

    expect(ctx).not.toBeNull();
    // A chime is three descending tones.
    expect(fake.oscillators).toHaveLength(3);
    expect(fake.oscillators.map((node) => node.frequency.value)).toEqual([523, 392, 330]);
    expect(fake.oscillators.every((node) => node.start.mock.calls.length === 1)).toBe(true);
  });

  it('uses a single oscillator for the single-tone sounds', () => {
    for (const sound of ['beep', 'alarm', 'kitchen', 'gentle'] as const) {
      const fake = makeContext();
      installAudioContext(() => fake.ctx);

      expect(playSoundOnce(sound)).not.toBeNull();
      expect(fake.oscillators).toHaveLength(1);
      expect(fake.oscillators[0].start).toHaveBeenCalledTimes(1);
    }
  });

  it('alternates frequencies for the urgent alarm', () => {
    const fake = makeContext();
    installAudioContext(() => fake.ctx);

    playSoundOnce('alarm');

    const [osc] = fake.oscillators;
    expect(osc.type).toBe('square');
    expect(osc.frequency.setValueAtTime).toHaveBeenCalledTimes(6);
  });

  it('closes the context after the sound has played', () => {
    vi.useFakeTimers();
    const fake = makeContext();
    installAudioContext(() => fake.ctx);

    playSoundOnce('beep');
    expect(fake.ctx.close).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2100);
    expect(fake.ctx.close).toHaveBeenCalledTimes(1);
  });

  it('returns null instead of throwing when the browser has no Web Audio', () => {
    // `AudioContext` missing entirely — the timer must still count down.
    (globalThis as { AudioContext?: unknown }).AudioContext = undefined;
    expect(playSoundOnce('beep')).toBeNull();

    // ...and when constructing it throws (autoplay policy, iOS quirks).
    installAudioContext(() => {
      throw new Error('not allowed');
    });
    expect(playSoundOnce('chime')).toBeNull();
  });
});
