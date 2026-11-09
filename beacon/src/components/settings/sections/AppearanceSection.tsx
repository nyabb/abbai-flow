/**
 * Appearance settings: theme picker, automatic dark mode, font size, sidebar
 * position and the advanced dashboard toggle.
 */
import { Check } from 'lucide-react';
import { themes } from '../../../styles/themes';
import { useTheme } from '../../../hooks/useTheme';
import { Segment, Toggle } from '../controls';
import type { SettingsSectionContext } from './context';

export function AppearanceSection({ settings, onUpdateSettings, t }: SettingsSectionContext) {
  const { setTheme: applyTheme } = useTheme();

  const themeEntries = [
    {
      id: 'auto',
      name: t('settings.appearance.themeAuto'),
      colors: ['#faf9f6', '#0f172a', '#3b82f6'],
    },
    ...themes.map((theme) => ({
      id: theme.id,
      name: theme.name,
      colors: [theme.colors.background, theme.colors.surface, theme.colors.accent],
    })),
  ];

  return (
    <>
      <h2 className="settings-section-title">{t('settings.appearance.title')}</h2>
      <p className="settings-section-desc">{t('settings.appearance.desc')}</p>

      <div className="settings-group">
        <div className="settings-group-title">{t('settings.appearance.themeTitle')}</div>
        <div className="settings-theme-grid">
          {themeEntries.map((entry) => {
            const isActive = entry.id === settings.themeId;
            return (
              <button
                key={entry.id}
                type="button"
                className={`settings-theme-card ${isActive ? 'settings-theme-card--active' : ''}`}
                onClick={() => {
                  onUpdateSettings({ themeId: entry.id });
                  applyTheme(entry.id);
                }}
              >
                <div className="settings-theme-preview">
                  {entry.colors.map((color, index) => (
                    <div
                      key={index}
                      className="settings-theme-swatch"
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
                <div className="settings-theme-name">{entry.name}</div>
                {isActive && (
                  <div className="settings-theme-check">
                    <Check size={12} strokeWidth={3} />
                  </div>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.appearance.autoDarkModeLabel')}</div>
            <div className="settings-row-sublabel">
              {t('settings.appearance.autoDarkModeSublabel')}
            </div>
          </div>
          <Toggle
            checked={settings.autoDarkMode}
            onChange={(v) => onUpdateSettings({ autoDarkMode: v })}
          />
        </div>
        {settings.autoDarkMode && (
          <>
            <div className="settings-row">
              <div className="settings-row-label">
                {t('settings.appearance.darkModeStartLabel')}
              </div>
              <input
                type="time"
                className="settings-time-input"
                value={settings.darkModeStart}
                onChange={(e) => onUpdateSettings({ darkModeStart: e.target.value })}
              />
            </div>
            <div className="settings-row">
              <div className="settings-row-label">{t('settings.appearance.darkModeEndLabel')}</div>
              <input
                type="time"
                className="settings-time-input"
                value={settings.darkModeEnd}
                onChange={(e) => onUpdateSettings({ darkModeEnd: e.target.value })}
              />
            </div>
          </>
        )}
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.appearance.fontSizeLabel')}</div>
            <div className="settings-row-sublabel">{t('settings.appearance.fontSizeSublabel')}</div>
          </div>
          <Segment
            value={settings.fontScale}
            options={[
              { value: 'normal', label: t('settings.appearance.fontNormal') },
              { value: 'large', label: t('settings.appearance.fontLarge') },
              { value: 'extra-large', label: t('settings.appearance.fontXL') },
            ]}
            onChange={(v) => onUpdateSettings({ fontScale: v })}
          />
        </div>
        <div className="settings-row">
          <div className="settings-row-label">{t('settings.appearance.sidebarPositionLabel')}</div>
          <Segment
            value={settings.sidebarPosition}
            options={[
              { value: 'left', label: t('settings.appearance.left') },
              { value: 'right', label: t('settings.appearance.right') },
              { value: 'bottom', label: t('settings.appearance.bottom') },
            ]}
            onChange={(v) => onUpdateSettings({ sidebarPosition: v })}
          />
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">
              {t('settings.appearance.advancedDashboardLabel')}
            </div>
            <div className="settings-row-sublabel">
              {t('settings.appearance.advancedDashboardSublabel')}
            </div>
          </div>
          <Toggle
            checked={settings.advancedDashboard}
            onChange={(v) => onUpdateSettings({ advancedDashboard: v })}
          />
        </div>
      </div>
    </>
  );
}
