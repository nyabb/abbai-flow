/** Chores settings: the single on/off switch that shows the chores screen. */
import { Toggle } from '../controls';
import type { SettingsSectionContext } from './context';

export function ChoresSection({ settings, onUpdateSettings, t }: SettingsSectionContext) {
  return (
    <>
      <h2 className="settings-section-title">{t('settings.chores.title')}</h2>
      <p className="settings-section-desc">{t('settings.chores.desc')}</p>

      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.chores.enableLabel')}</div>
            <div className="settings-row-sublabel">{t('settings.chores.enableSublabel')}</div>
          </div>
          <Toggle
            checked={settings.choresEnabled}
            onChange={(v) => onUpdateSettings({ choresEnabled: v })}
          />
        </div>
      </div>
    </>
  );
}
