/** About settings: version, connection state and the maintenance buttons. */
import type { SettingsSectionContext } from './context';

export interface AboutSectionProps extends SettingsSectionContext {
  onExport: () => void;
  onImport: () => void;
  onClearLocalStorage: () => void;
  onResetSettings: () => void;
}

export function AboutSection({
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
          <span className="settings-about-label">{t('settings.about.sourceCode')}</span>
          <span className="settings-about-value">
            <a href="https://github.com/nyabb/abbai-flow" target="_blank" rel="noopener noreferrer">
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
