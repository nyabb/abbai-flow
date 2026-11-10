import { describe, it, expect, vi, afterEach } from 'vitest';
import { getSecureItem, setSecureItem, removeSecureItem, StorageKeys } from './secure-storage';

/**
 * Credential storage is plain `localStorage` now that the native shell is gone.
 * The guards matter on iOS Safari private mode, where touching `localStorage`
 * throws — a failed read must return null, not break the app.
 */
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('secure storage', () => {
  it('round-trips a value', async () => {
    await setSecureItem(StorageKeys.HA_TOKEN, 'abc123');

    await expect(getSecureItem(StorageKeys.HA_TOKEN)).resolves.toBe('abc123');
  });

  it('removes a value', async () => {
    await setSecureItem(StorageKeys.HA_URL, 'http://ha.local:8123');
    await removeSecureItem(StorageKeys.HA_URL);

    await expect(getSecureItem(StorageKeys.HA_URL)).resolves.toBeNull();
  });

  it('returns null for a key that was never written', async () => {
    await expect(getSecureItem('beacon_missing')).resolves.toBeNull();
  });

  it('does not throw when storage refuses to read', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    await expect(getSecureItem(StorageKeys.HA_TOKEN)).resolves.toBeNull();
  });

  it('does not throw when storage refuses to write', async () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    await expect(setSecureItem(StorageKeys.HA_TOKEN, 'x')).resolves.toBeUndefined();
  });
});
