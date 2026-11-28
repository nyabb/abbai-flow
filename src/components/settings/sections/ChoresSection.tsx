/** Chores settings are owned by ChoresMan. */
import { useState } from 'react';
import { resetAllChoresManData } from '../../../hooks/useChoresMan';
import { normalizePin, type FamilyMember } from '../../../types/family';
import type { SettingsSectionContext } from './context';

interface ChoresSectionProps extends SettingsSectionContext {
  members: FamilyMember[];
}

export function ChoresSection({ t, members }: ChoresSectionProps) {
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSucceeded, setResetSucceeded] = useState(false);
  const [resetPin, setResetPin] = useState('');

  const hasParentPin = members.some(
    (member) => member.role !== 'child' && normalizePin(member.pin).length >= 4,
  );

  const confirmReset = async () => {
    const enteredPin = normalizePin(resetPin);
    const validParentPin = members.some(
      (member) =>
        member.role !== 'child' &&
        normalizePin(member.pin).length >= 4 &&
        normalizePin(member.pin) === enteredPin,
    );
    if (!validParentPin) {
      setResetError(t('settings.chores.resetPinWrong'));
      return;
    }

    setResetting(true);
    setResetError(null);
    try {
      await resetAllChoresManData();
      setConfirmingReset(false);
      setResetSucceeded(true);
    } catch (error) {
      setResetError(error instanceof Error ? error.message : t('settings.chores.resetError'));
    } finally {
      setResetting(false);
    }
  };

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

      <div className="settings-group settings-chores-reset">
        <div className="settings-row">
          <div>
            <div className="settings-row-label">{t('settings.chores.resetTitle')}</div>
            <div className="settings-row-sublabel">{t('settings.chores.resetDescription')}</div>
          </div>
          <button
            className="settings-btn settings-btn--danger"
            type="button"
            disabled={resetting}
            onClick={() => {
              setConfirmingReset(true);
              setResetSucceeded(false);
              setResetError(null);
              setResetPin('');
            }}
          >
            {t('settings.chores.resetButton')}
          </button>
        </div>

        {confirmingReset && (
          <div className="settings-chores-reset-confirm" role="alertdialog" aria-labelledby="chores-reset-confirm-title" aria-describedby="chores-reset-confirm-description">
            <div id="chores-reset-confirm-title" className="settings-row-label">
              {t('settings.chores.resetConfirmTitle')}
            </div>
            <p id="chores-reset-confirm-description" className="settings-row-sublabel">
              {t('settings.chores.resetConfirmDescription')}
            </p>
            {hasParentPin ? (
              <label className="settings-chores-reset-pin">
                <span className="settings-row-label">{t('settings.chores.resetPinLabel')}</span>
                <input
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  autoFocus
                  maxLength={6}
                  value={resetPin}
                  onChange={(event) => {
                    setResetPin(normalizePin(event.target.value));
                    setResetError(null);
                  }}
                  aria-label={t('settings.chores.resetPinLabel')}
                />
              </label>
            ) : (
              <p className="settings-chores-reset-error" role="alert">{t('settings.chores.resetPinRequired')}</p>
            )}
            {resetError && <p className="settings-chores-reset-error" role="alert">{resetError}</p>}
            <div className="settings-btn-group">
              <button className="settings-btn" type="button" disabled={resetting} onClick={() => setConfirmingReset(false)}>
                {t('settings.chores.resetCancel')}
              </button>
              <button className="settings-btn settings-btn--danger" type="button" disabled={resetting || !hasParentPin || resetPin.length < 4} onClick={() => void confirmReset()}>
                {resetting ? t('settings.chores.resetting') : t('settings.chores.resetConfirm')}
              </button>
            </div>
          </div>
        )}
        {resetSucceeded && <p className="settings-chores-reset-success" role="status">{t('settings.chores.resetSuccess')}</p>}
      </div>
    </>
  );
}
