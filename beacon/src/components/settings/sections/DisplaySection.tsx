/**
 * Display settings: screen saver, dim timings, always-on behaviour and the
 * Kid Display (focus mode) launcher with its copyable device URL.
 *
 * The selected member and "copied" flag are local UI state, so they live here
 * rather than in the settings screen.
 */
import { useState } from 'react';
import { buildFocusUrl } from '../../../focus';
import type { FamilyMember } from '../../../types/family';
import { Slider, Toggle } from '../controls';
import type { SettingsSectionContext } from './context';

export interface DisplaySectionProps extends SettingsSectionContext {
  members: FamilyMember[];
  onEnterFocusMode: (memberId: string) => void;
}

export function DisplaySection({
  settings,
  onUpdateSettings,
  t,
  members,
  onEnterFocusMode,
}: DisplaySectionProps) {
  const [kidDisplayMemberId, setKidDisplayMemberId] = useState('');
  const [copiedFocusUrl, setCopiedFocusUrl] = useState(false);

  const copyFocusUrl = () => {
    const url = buildFocusUrl(kidDisplayMemberId);
    if (!navigator.clipboard) {
      window.prompt(t('settings.display.copyUrlPrompt'), url);
      return;
    }
    navigator.clipboard
      .writeText(url)
      .then(() => setCopiedFocusUrl(true))
      .catch(() => {
        window.prompt(t('settings.display.copyUrlPrompt'), url);
      });
  };

  return (
    <>
      <h2 className="settings-section-title">{t('settings.display.title')}</h2>
      <p className="settings-section-desc">{t('settings.display.desc')}</p>

      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.display.screenSaverLabel')}</div>
            <div className="settings-row-sublabel">{t('settings.display.screenSaverSublabel')}</div>
          </div>
          <Toggle
            checked={settings.screenSaverEnabled}
            onChange={(v) => onUpdateSettings({ screenSaverEnabled: v })}
          />
        </div>
        {settings.screenSaverEnabled && (
          <>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">{t('settings.display.dimAfterLabel')}</div>
                <div className="settings-row-sublabel">
                  {t('settings.display.dimAfterSublabel')}
                </div>
              </div>
              <Slider
                value={settings.dimTimeout}
                min={1}
                max={30}
                unit=" min"
                onChange={(v) => onUpdateSettings({ dimTimeout: v })}
              />
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">
                  {t('settings.display.screenSaverAfterLabel')}
                </div>
                <div className="settings-row-sublabel">
                  {t('settings.display.screenSaverAfterSublabel')}
                </div>
              </div>
              <Slider
                value={settings.screenSaverTimeout}
                min={5}
                max={60}
                step={5}
                unit=" min"
                onChange={(v) => onUpdateSettings({ screenSaverTimeout: v })}
              />
            </div>
          </>
        )}
      </div>

      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.display.alwaysOnLabel')}</div>
            <div className="settings-row-sublabel">{t('settings.display.alwaysOnSublabel')}</div>
          </div>
          <Toggle
            checked={settings.alwaysOnDisplay}
            onChange={(v) => onUpdateSettings({ alwaysOnDisplay: v })}
          />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.display.showSecondsLabel')}</div>
            <div className="settings-row-sublabel">{t('settings.display.showSecondsSublabel')}</div>
          </div>
          <Toggle
            checked={settings.showSeconds}
            onChange={(v) => onUpdateSettings({ showSeconds: v })}
          />
        </div>
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.display.kioskModeLabel')}</div>
            <div className="settings-row-sublabel">{t('settings.display.kioskModeSublabel')}</div>
          </div>
          <Toggle
            checked={settings.kioskMode}
            onChange={(v) => onUpdateSettings({ kioskMode: v })}
          />
        </div>
      </div>

      <h2 className="settings-section-title" style={{ marginTop: 32 }}>
        {t('settings.display.kidDisplayTitle')}
      </h2>
      <p className="settings-section-desc">{t('settings.display.kidDisplayDesc')}</p>
      <div className="settings-group">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.display.familyMemberLabel')}</div>
            <div className="settings-row-sublabel">
              {t('settings.display.familyMemberSublabel')}
            </div>
          </div>
          <select
            className="settings-select"
            value={kidDisplayMemberId}
            onChange={(e) => {
              setKidDisplayMemberId(e.target.value);
              setCopiedFocusUrl(false);
            }}
          >
            <option value="">{t('settings.display.chooseAMember')}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.avatar} {member.name}
              </option>
            ))}
          </select>
        </div>
        {kidDisplayMemberId && (
          <>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">{t('settings.display.useOnDeviceLabel')}</div>
                <div className="settings-row-sublabel">
                  {t('settings.display.useOnDeviceSublabel')}
                </div>
              </div>
              <button
                type="button"
                className="settings-btn settings-btn--primary"
                onClick={() => onEnterFocusMode(kidDisplayMemberId)}
              >
                {t('common.start')}
              </button>
            </div>
            <div className="settings-row">
              <div>
                <div className="settings-row-label">{t('settings.display.displayUrlLabel')}</div>
                <div className="settings-row-sublabel">
                  {t('settings.display.displayUrlSublabel')}
                </div>
              </div>
              <button type="button" className="settings-btn" onClick={copyFocusUrl}>
                {copiedFocusUrl ? t('settings.display.copied') : t('settings.display.copyUrl')}
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
