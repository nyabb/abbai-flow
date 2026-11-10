/**
 * Haptic feedback.
 *
 * Beacon is a web app, so this uses the Vibration API where the browser exposes
 * it — Android Chrome does, iOS Safari and desktop browsers do not — and
 * degrades to a no-op everywhere else. Call sites keep the same four helpers so
 * nothing else had to change when the native shell was dropped.
 */

function vibrate(pattern: number | number[]): void {
  try {
    // `vibrate` is missing on iOS Safari; the guard keeps that a no-op rather
    // than an exception inside a click handler.
    globalThis.navigator?.vibrate?.(pattern);
  } catch {
    /* vibration blocked by the browser or the OS — not an error */
  }
}

/** Light tap — for button presses, toggles */
export function hapticTap(): void {
  vibrate(10);
}

/** Medium impact — for completing items, drag drops */
export function hapticMedium(): void {
  vibrate(25);
}

/** Success notification — for completing all tasks, saving events */
export function hapticSuccess(): void {
  vibrate([12, 40, 18]);
}

/** Warning notification — for delete confirmations */
export function hapticWarning(): void {
  vibrate([30, 60, 30]);
}
