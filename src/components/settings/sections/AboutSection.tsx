/** About settings: version, connection state and the maintenance buttons. */
import type { SettingsSectionContext } from './context';

export interface AboutSectionProps extends SettingsSectionContext {
  connected: boolean;
  haUrl: string;
  onExport: () => void;
  onImport: () => void;
  onClearLocalStorage: () => void;
  onResetSettings: () => void;
}

export function AboutSection({
  connected,
  haUrl,
  onExport,
  onImport,
  onClearLocalStorage,
  onResetSettings,
  t,
}: AboutSectionProps) {
  return (
    <>
      <h2 className="settings-section-title">{t('settings.about.title')}</h2>
      <p className="settings-section-desc">{t('settings.about.desc')}</p>

      <div className="settings-group">
        <div className="settings-about-row">
          <span className="settings-about-label">{t('settings.about.version')}</span>
          <span className="settings-about-value">{__APP_VERSION__}</span>
        </div>
        <div className="settings-about-row">
          <span className="settings-about-label">{t('settings.about.homeAssistant')}</span>
          <span className="settings-about-value">
            <span
              className={`settings-status-dot ${connected ? 'settings-status-dot--connected' : 'settings-status-dot--disconnected'}`}
              style={{ display: 'inline-block', marginRight: 6, verticalAlign: 'middle' }}
            />
            {connected
              ? t('settings.integrations.connected')
              : t('settings.integrations.disconnected')}
          </span>
        </div>
        <div className="settings-about-row">
          <span className="settings-about-label">{t('settings.about.haUrl')}</span>
          <span className="settings-about-value">{haUrl}</span>
        </div>
        <div className="settings-about-row">
          <span className="settings-about-label">{t('settings.about.sourceCode')}</span>
          <span className="settings-about-value">
            <a href="https://github.com/asachs01/beacon" target="_blank" rel="noopener noreferrer">
              {t('settings.about.github')}
            </a>
          </span>
        </div>
        <div className="settings-about-row">
          <span className="settings-about-label">{t('settings.about.license')}</span>
          <span className="settings-about-value">MIT</span>
        </div>
      </div>

      <div className="settings-group">
        <div className="settings-group-title">{t('settings.about.debugTitle')}</div>
        <div style={{ padding: '12px 20px 16px' }}>
          <div className="settings-btn-group">
            <button type="button" className="settings-btn" onClick={onExport}>
              {t('settings.about.exportSettings')}
            </button>
            <button type="button" className="settings-btn" onClick={onImport}>
              {t('settings.about.importSettings')}
            </button>
            <button
              type="button"
              className="settings-btn settings-btn--danger"
              onClick={onClearLocalStorage}
            >
              {t('settings.about.clearLocalStorage')}
            </button>
            <button
              type="button"
              className="settings-btn settings-btn--danger"
              onClick={onResetSettings}
            >
              {t('settings.about.resetToDefaults')}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
