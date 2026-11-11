/**
 * What every settings section needs.
 *
 * Sections are presentational: they read from the settings object and call
 * `onUpdateSettings` with a patch. Anything section-specific (family member
 * CRUD, HA connection state…) is added by that section's own props, so this
 * shape stays small.
 */
import type { I18nValue } from '../../../i18n';
import type { AbbaiSettings } from '../../../hooks/useSettings';

export interface SettingsSectionContext {
  settings: AbbaiSettings;
  onUpdateSettings: (patch: Partial<AbbaiSettings>) => void;
  t: I18nValue['t'];
}
