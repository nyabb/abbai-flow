import { describe, it, expect, vi, afterEach } from 'vitest';
import { hapticTap, hapticMedium, hapticSuccess, hapticWarning } from './useHaptics';

/**
 * Haptics used to be a no-op on the web (they were Capacitor-only). They now go
 * through the Vibration API, which exists on Android Chrome and nowhere else —
 * so the important cases are "does it vibrate when supported" and "does it stay
 * silent and safe when not".
 */
const originalVibrate = navigator.vibrate;

afterEach(() => {
  Object.defineProperty(navigator, 'vibrate', {
    value: originalVibrate,
    configurable: true,
    writable: true,
  });
});

function stubVibrate() {
  const vibrate = vi.fn().mockReturnValue(true);
  Object.defineProperty(navigator, 'vibrate', {
    value: vibrate,
    configurable: true,
    writable: true,
  });
  return vibrate;
}

describe('haptics', () => {
  it('vibrates on a tap when the browser supports it', () => {
    const vibrate = stubVibrate();

    hapticTap();

    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it('uses distinct patterns for success and warning', () => {
    const vibrate = stubVibrate();

    hapticSuccess();
    hapticWarning();

    expect(vibrate).toHaveBeenNthCalledWith(1, [12, 40, 18]);
    expect(vibrate).toHaveBeenNthCalledWith(2, [30, 60, 30]);
  });

  it('does nothing when the browser has no Vibration API', () => {
    Object.defineProperty(navigator, 'vibrate', {
      value: undefined,
      configurable: true,
      writable: true,
    });

    expect(() => hapticMedium()).not.toThrow();
  });

  it('swallows a browser that rejects vibration', () => {
    Object.defineProperty(navigator, 'vibrate', {
      value: () => {
        throw new Error('blocked');
      },
      configurable: true,
      writable: true,
    });

    expect(() => hapticMedium()).not.toThrow();
  });
});
