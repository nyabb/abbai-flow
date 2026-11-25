/** Chores settings are owned by ChoresMan. */
import type { SettingsSectionContext } from './context';

export function ChoresSection({ t }: SettingsSectionContext) {
  return (
    <>
      <h2 className="settings-section-title">{t('settings.chores.title')}</h2>
      <p className="settings-section-desc">{t('settings.chores.desc')}</p>

      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.chores.sourceLabel')}</div>
            <div className="settings-row-sublabel">{t('settings.chores.sourceSublabel')}</div>
          </div>
        </div>
      </div>
    </>
  );
}
