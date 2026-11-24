/**
 * General settings: family name, start view, time/week format, browser-cache
 * toggle. Language is changed from every
 * page's header.
 */
import { getConfig } from '../../../config';
import { isAddOn } from '../../../utils/ha-env';
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
            <option value="calendar">{t('nav.calendar')}</option>
            <option value="grocery">{t('nav.grocery')}</option>
            <option value="music">{t('nav.music')}</option>
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
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.general.debugModeLabel')}</div>
            <div className="settings-row-sublabel">{t('settings.general.debugModeSublabel')}</div>
          </div>
          <Toggle
            checked={settings.debugMode}
            onChange={(v) => onUpdateSettings({ debugMode: v })}
          />
        </div>
      </div>

    </>
  );
}
