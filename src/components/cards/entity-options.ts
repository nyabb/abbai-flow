/**
 * The entity list behind the card entity pickers.
 *
 * This lives in its own module (not in `EntityPicker.tsx`) for two reasons: the
 * fetch/cache is shared by every picker instance, and a module that exports
 * both components and helpers breaks React Fast Refresh.
 */
import { useEffect, useState } from 'react';
import { getAllEntityStates } from '../../api/ha-rest';

export interface EntityOption {
  entity_id: string;
  label: string;
  domain: string;
}

/** Shared by every picker instance so the full entity list is fetched once, not per mount. */
let entityOptionsRequest: Promise<EntityOption[]> | null = null;

function loadEntityOptions(): Promise<EntityOption[]> {
  if (!entityOptionsRequest) {
    entityOptionsRequest = getAllEntityStates()
      .then((states) =>
        states
          .map((state) => ({
            entity_id: state.entity_id,
            label:
              typeof state.attributes.friendly_name === 'string'
                ? state.attributes.friendly_name
                : state.entity_id,
            domain: state.entity_id.split('.')[0],
          }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      )
      .catch(() => {
        entityOptionsRequest = null;
        return [];
      });
  }
  return entityOptionsRequest;
}

/** Drop the cache so the next mount refetches (after entities change in HA). */
export function invalidateEntityOptions(): void {
  entityOptionsRequest = null;
}

export function useEntityOptions(): EntityOption[] {
  const [options, setOptions] = useState<EntityOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    loadEntityOptions().then((loaded) => {
      if (!cancelled) setOptions(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return options;
}

export function filterEntityOptions(
  options: EntityOption[],
  search: string,
  domain: string,
): EntityOption[] {
  const term = search.trim().toLowerCase();
  return options.filter((option) => {
    if (domain && option.domain !== domain) return false;
    if (!term) return true;
    return (
      option.label.toLowerCase().includes(term) || option.entity_id.toLowerCase().includes(term)
    );
  });
}
