import { describe, expect, it } from 'vitest';
import { migrateLegacyStorageKeys } from './storage-migration';

describe('migrateLegacyStorageKeys', () => {
  it('copies old browser data to the Abbai Flow key and retains the old value', () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem('beacon-family-members', '[{"name":"Ari"}]');
    storage.setItem('beacon_display_member', 'ari');

    migrateLegacyStorageKeys(storage);

    expect(storage.getItem('abbai-flow-family-members')).toBe('[{"name":"Ari"}]');
    expect(storage.getItem('abbai_flow_display_member')).toBe('ari');
    expect(storage.getItem('beacon-family-members')).toBe('[{"name":"Ari"}]');
    expect(storage.getItem('beacon_display_member')).toBe('ari');
  });

  it('keeps an already migrated value as authoritative', () => {
    const storage = window.localStorage;
    storage.clear();
    storage.setItem('beacon-settings', 'legacy');
    storage.setItem('abbai-flow-settings', 'current');

    migrateLegacyStorageKeys(storage);

    expect(storage.getItem('abbai-flow-settings')).toBe('current');
  });
});
