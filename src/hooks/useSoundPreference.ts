import { useSyncExternalStore } from 'react';

const STORAGE_KEY = 'abbai-flow-sound-enabled';
const listeners = new Set<() => void>();

function readStoredSoundPreference(): boolean {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

let soundEnabled = readStoredSoundPreference();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): boolean {
  return soundEnabled;
}

function setSoundPreference(enabled: boolean): void {
  if (soundEnabled === enabled) return;
  soundEnabled = enabled;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(enabled));
  } catch {
    // The preference still applies for the current session.
  }
  for (const listener of listeners) listener();
}

export function useSoundPreference(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, getSnapshot, () => true);
  return [enabled, setSoundPreference];
}
