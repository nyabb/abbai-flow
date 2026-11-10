/**
 * Timer sound engine.
 *
 * Lives outside the timer page so an alarm can ring while the family is looking
 * at the dashboard: the countdown store fires the event, this module makes the
 * noise, and the preference is shared.
 */
const SOUND_STORAGE_KEY = 'beacon-timer-sound';

export type SoundName = 'beep' | 'chime' | 'alarm' | 'kitchen' | 'gentle';

const KNOWN_SOUNDS: SoundName[] = ['beep', 'chime', 'alarm', 'kitchen', 'gentle'];

export function getStoredSound(): SoundName {
  try {
    const v = localStorage.getItem(SOUND_STORAGE_KEY);
    if (v && KNOWN_SOUNDS.includes(v as SoundName)) return v as SoundName;
  } catch {
    /* ignore */
  }
  return 'chime';
}

/** Play a single instance of the chosen sound. Returns the AudioContext so it can be closed. */
export function playSoundOnce(sound: SoundName): AudioContext | null {
  try {
    const ctx = new AudioContext();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    const now = ctx.currentTime;

    if (sound === 'beep') {
      // 880Hz sine wave, 3 short beeps
      const osc = ctx.createOscillator();
      osc.connect(gain);
      osc.frequency.value = 880;
      osc.type = 'sine';
      gain.gain.value = 0.3;
      gain.gain.setValueAtTime(0.3, now);
      gain.gain.setValueAtTime(0, now + 0.15);
      gain.gain.setValueAtTime(0.3, now + 0.25);
      gain.gain.setValueAtTime(0, now + 0.4);
      gain.gain.setValueAtTime(0.3, now + 0.5);
      gain.gain.setValueAtTime(0, now + 0.65);
      osc.start(now);
      osc.stop(now + 0.7);
    } else if (sound === 'chime') {
      // Descending tones: C5 (523), G4 (392), E4 (330)
      const freqs = [523, 392, 330];
      freqs.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.connect(g);
        g.connect(ctx.destination);
        osc.frequency.value = freq;
        osc.type = 'sine';
        const t = now + i * 0.3;
        g.gain.setValueAtTime(0.25, t);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.start(t);
        osc.stop(t + 0.45);
      });
    } else if (sound === 'alarm') {
      // Alternating 600Hz/900Hz, urgent
      const osc = ctx.createOscillator();
      osc.connect(gain);
      osc.type = 'square';
      gain.gain.value = 0.2;
      for (let i = 0; i < 6; i++) {
        const t = now + i * 0.15;
        osc.frequency.setValueAtTime(i % 2 === 0 ? 600 : 900, t);
      }
      osc.start(now);
      osc.stop(now + 0.9);
    } else if (sound === 'kitchen') {
      // Rapid high-pitched beeps at 1200Hz
      const osc = ctx.createOscillator();
      osc.connect(gain);
      osc.frequency.value = 1200;
      osc.type = 'sine';
      for (let i = 0; i < 5; i++) {
        const t = now + i * 0.12;
        gain.gain.setValueAtTime(0.3, t);
        gain.gain.setValueAtTime(0, t + 0.06);
      }
      osc.start(now);
      osc.stop(now + 0.65);
    } else if (sound === 'gentle') {
      // Soft low tone 440Hz with slow fade
      const osc = ctx.createOscillator();
      osc.connect(gain);
      osc.frequency.value = 440;
      osc.type = 'sine';
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
      osc.start(now);
      osc.stop(now + 1.6);
    }

    // Auto-close after 2s to free resources
    setTimeout(() => {
      try {
        ctx.close();
      } catch {
        /* */
      }
    }, 2000);
    return ctx;
  } catch {
    return null;
  }
}



export function setStoredSound(sound: SoundName): void {
  try {
    localStorage.setItem(SOUND_STORAGE_KEY, sound);
  } catch {
    /* Storage is optional. */
  }
}
