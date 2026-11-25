/** Chores settings: choose the active chore provider. */
import { Segment } from '../controls';
import type { SettingsSectionContext } from './context';

export function ChoresSection({ settings, onUpdateSettings, t }: SettingsSectionContext) {
  return (
    <>
      <h2 className="settings-section-title">{t('settings.chores.title')}</h2>
      <p className="settings-section-desc">{t('settings.chores.desc')}</p>

      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.chores.providerLabel')}</div>
            <div className="settings-row-sublabel">{t('settings.chores.providerSublabel')}</div>
          </div>
          <Segment
            value={settings.choresProvider}
            options={[
              { value: 'choreops', label: t('settings.chores.providerChoreOps') },
              { value: 'choresman', label: t('settings.chores.providerChoresman') },
            ]}
            onChange={(value) => onUpdateSettings({ choresProvider: value })}
          />
        </div>
      </div>
    </>
  );
}
