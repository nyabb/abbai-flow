/**
 * General settings: family name, start view, time/week format, language,
 * browser-cache toggle and the dashboard layout presets.
 */
import { getConfig } from '../../../config';
import { isAddOn } from '../../../utils/ha-env';
import { LOCALE_OPTIONS } from '../../../i18n/locales';
import type { AbbaiSettings } from '../../../hooks/useSettings';
import { Segment, Toggle } from '../controls';
import type { SettingsSectionContext } from './context';

export function GeneralSection({ settings, onUpdateSettings, t }: SettingsSectionContext) {
  return (
    <>
      <h2 className="settings-section-title">{t('settings.general.title')}</h2>
      <p className="settings-section-desc">{t('settings.general.desc')}</p>

      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.general.familyNameLabel')}</div>
            <div className="settings-row-sublabel">{t('settings.general.familyNameSublabel')}</div>
          </div>
          <input
            type="text"
            className="settings-input"
            value={settings.familyName}
            onChange={(e) => onUpdateSettings({ familyName: e.target.value })}
          />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.general.defaultViewLabel')}</div>
            <div className="settings-row-sublabel">{t('settings.general.defaultViewSublabel')}</div>
          </div>
          <select
            className="form-select"
            value={settings.defaultView}
            onChange={(e) =>
              onUpdateSettings({ defaultView: e.target.value as AbbaiSettings['defaultView'] })
            }
            style={{ maxWidth: 180 }}
          >
            <option value="dashboard">{t('nav.dashboard')}</option>
            <option value="calendar">{t('nav.calendar')}</option>
            <option value="grocery">{t('nav.grocery')}</option>
            <option value="music">{t('nav.music')}</option>
            <option value="photos">{t('nav.photos')}</option>
          </select>
        </div>
        <div className="settings-row">
          <div className="settings-row-label">{t('settings.general.timeFormatLabel')}</div>
          <Segment
            value={settings.timeFormat}
            options={[
              { value: '12h', label: '12h' },
              { value: '24h', label: '24h' },
            ]}
            onChange={(v) => onUpdateSettings({ timeFormat: v })}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-label">{t('settings.general.weekStartsOnLabel')}</div>
          <Segment
            value={String(settings.weekStartsOn) as '0' | '1'}
            options={[
              { value: '0', label: t('settings.general.sunday') },
              { value: '1', label: t('settings.general.monday') },
            ]}
            onChange={(v) => onUpdateSettings({ weekStartsOn: Number(v) as 0 | 1 })}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-label">{t('settings.general.languageLabel')}</div>
          <select
            className="settings-select"
            value={settings.locale}
            onChange={(e) => onUpdateSettings({ locale: e.target.value })}
          >
            {LOCALE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        {isAddOn() && (
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Save Configuration in Browser</div>
              <div className="settings-row-sublabel">
                {getConfig().save_config_in_browser
                  ? 'Keep a local browser copy; Home Assistant remains the shared source.'
                  : 'Disabled by the Home Assistant add-on configuration.'}
              </div>
            </div>
            <Toggle
              checked={settings.saveConfigInBrowser}
              disabled={!getConfig().save_config_in_browser}
              onChange={(v) => onUpdateSettings({ saveConfigInBrowser: v })}
            />
          </div>
        )}
      </div>

      <h2 className="settings-section-title" style={{ marginTop: 32 }}>
        {t('settings.general.dashboardLayoutTitle')}
      </h2>
      <p className="settings-section-desc">{t('settings.general.dashboardLayoutDesc')}</p>
      <div className="settings-group">
        <div className="settings-row" style={{ alignItems: 'flex-start' }}>
          <div>
            <div className="settings-row-label">{t('settings.general.layoutLabel')}</div>
            <div className="settings-row-sublabel">{t('settings.general.layoutSublabel')}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {(
              [
                {
                  id: 'default',
                  label: t('settings.general.layoutFamilyLabel'),
                  desc: t('settings.general.layoutFamilyDesc'),
                },
                {
                  id: 'classic',
                  label: t('settings.general.layoutClassicLabel'),
                  desc: t('settings.general.layoutClassicDesc'),
                },
                {
                  id: 'compact',
                  label: t('settings.general.layoutCompactLabel'),
                  desc: t('settings.general.layoutCompactDesc'),
                },
              ] as const
            ).map((preset) => (
              <button
                key={preset.id}
                type="button"
                onClick={() => onUpdateSettings({ dashboardLayout: preset.id })}
                style={{
                  padding: '10px 14px',
                  borderRadius: 10,
                  border:
                    settings.dashboardLayout === preset.id
                      ? '2px solid var(--accent)'
                      : '1px solid var(--border)',
                  background:
                    settings.dashboardLayout === preset.id
                      ? 'var(--bg-today)'
                      : 'var(--bg-surface)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  minWidth: 100,
                  transition: 'all 150ms ease',
                }}
              >
                <div style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                  {preset.label}
                </div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 2 }}>
                  {preset.desc}
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
