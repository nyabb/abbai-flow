/**
 * Copy legacy Beacon-prefixed browser storage keys to Abbai Flow names.
 *
 * Old keys are retained so an interrupted upgrade or a temporary rollback
 * cannot erase the household's cached data. New keys always take precedence.
 */
export function migrateLegacyStorageKeys(storage?: Storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) return;
    // User-created dashboard layouts have no destination in the current app.
    target.removeItem('abbai-flow-dashboard-layout');
    const legacyKeys: string[] = [];
    for (let index = 0; index < target.length; index += 1) {
      const key = target.key(index);
      if (key?.startsWith('beacon-') || key?.startsWith('beacon_')) legacyKeys.push(key);
    }
    for (const legacyKey of legacyKeys) {
      const newKey = legacyKey.startsWith('beacon-')
        ? legacyKey.replace(/^beacon-/, 'abbai-flow-')
        : legacyKey.replace(/^beacon_/, 'abbai_flow_');
      if (target.getItem(newKey) === null) {
        const value = target.getItem(legacyKey);
        if (value !== null) target.setItem(newKey, value);
      }
    }
    for (const obsoleteKey of [
      'abbai_flow_ha_url',
      'abbai_flow_ha_token',
      'abbai_flow_ha_refresh_token',
      'abbai_flow_onboarded',
      'beacon_ha_url',
      'beacon_ha_token',
      'beacon_ha_refresh_token',
      'beacon_onboarded',
    ]) {
      target.removeItem(obsoleteKey);
    }
  } catch {
    // Private browsing and constrained webviews may not allow storage access.
  }
}
