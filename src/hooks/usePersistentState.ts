import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

export type PersistentValueValidator<T> = (value: unknown) => value is T;

/** Local UI preferences that should survive page changes and reloads. */
export function usePersistentState<T>(
  key: string,
  initialValue: T,
  isValid: PersistentValueValidator<T>,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return initialValue;
      const stored: unknown = JSON.parse(raw);
      return isValid(stored) ? stored : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Persistence is optional; keep the current value in memory.
    }
  }, [key, value]);

  return [value, setValue];
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
