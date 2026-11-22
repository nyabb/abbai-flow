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
  } catch {
    // Private browsing and constrained webviews may not allow storage access.
  }
}
