/**
 * Credential storage for the Home Assistant URL and access token.
 *
 * Beacon is web-only: the values live in `localStorage`. The functions stay
 * async so call sites never had to care whether the backing store was
 * synchronous, and a future backend can be swapped in without touching them.
 *
 * Every access is guarded: `localStorage` throws in Safari private mode and can
 * be unavailable in some embedded webviews, and a failed read must not take the
 * app down.
 */
export const StorageKeys = {
  HA_URL: 'beacon_ha_url',
  HA_TOKEN: 'beacon_ha_token',
  HA_REFRESH_TOKEN: 'beacon_ha_refresh_token',
  ONBOARDED: 'beacon_onboarded',
} as const;

/** Read a stored value, or `null` when it is absent or unreadable. */
export async function getSecureItem(key: string): Promise<string | null> {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Store a value. Silently does nothing when storage is unavailable. */
export async function setSecureItem(key: string, value: string): Promise<void> {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage blocked or full — the caller cannot recover from it */
  }
}

/** Remove a stored value. */
export async function removeSecureItem(key: string): Promise<void> {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* ignore */
  }
}
