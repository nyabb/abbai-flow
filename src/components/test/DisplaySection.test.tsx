import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DisplaySection } from '../settings/sections/DisplaySection';
import { I18nContext, createI18n } from '../../i18n';
import type { BeaconSettings } from '../../hooks/useSettings';

/**
 * The display-mode controls: everything the kiosk phase added has to be
 * reachable from Settings > Display, and each control has to write the key the
 * rest of the app reads.
 */
const NL = createI18n('nl');

function makeSettings(overrides: Partial<BeaconSettings> = {}): BeaconSettings {
  return {
    screenSaverEnabled: true,
    dimTimeout: 5,
    screenSaverTimeout: 10,
    alwaysOnDisplay: false,
    showSeconds: false,
    kioskMode: false,
    displayWakeLock: true,
    displayFullscreen: false,
    displayIdleMinutes: 15,
    displayPanels: { agenda: true, chores: true, family: true, weather: true },
    reducedMotion: false,
    ...overrides,
  } as BeaconSettings;
}

function renderSection(overrides: Partial<BeaconSettings> = {}) {
  const onUpdateSettings = vi.fn();
  const utils = render(
    <I18nContext.Provider value={NL}>
      <DisplaySection
        settings={makeSettings(overrides)}
        onUpdateSettings={onUpdateSettings}
        t={NL.t}
        members={[]}
        onEnterFocusMode={vi.fn()}
      />
    </I18nContext.Provider>,
  );
  return { ...utils, onUpdateSettings };
}

const row = (label: string) => screen.getByText(label).closest('.settings-row') as HTMLElement;
const checkboxIn = (label: string) => within(row(label)).getByRole('checkbox') as HTMLInputElement;

describe('DisplaySection — display mode', () => {
  it('shows the display-mode group', () => {
    renderSection();

    expect(screen.getByText(NL.t('settings.display.displayModeTitle'))).toBeInTheDocument();
  });

  it('toggles the wake lock', () => {
    const { onUpdateSettings } = renderSection({ displayWakeLock: true });

    fireEvent.click(checkboxIn(NL.t('settings.display.wakeLockLabel')));

    expect(onUpdateSettings).toHaveBeenCalledWith({ displayWakeLock: false });
  });

  it('toggles fullscreen', () => {
    const { onUpdateSettings } = renderSection({ displayFullscreen: false });

    fireEvent.click(checkboxIn(NL.t('settings.display.fullscreenLabel')));

    expect(onUpdateSettings).toHaveBeenCalledWith({ displayFullscreen: true });
  });

  it('changes the idle timeout, including "never"', () => {
    const { onUpdateSettings } = renderSection({ displayIdleMinutes: 15 });

    fireEvent.click(screen.getByRole('button', { name: '30 min' }));
    expect(onUpdateSettings).toHaveBeenCalledWith({ displayIdleMinutes: 30 });

    fireEvent.click(screen.getByRole('button', { name: NL.t('settings.display.never') }));
    expect(onUpdateSettings).toHaveBeenCalledWith({ displayIdleMinutes: 0 });
  });

  it('switches individual panels on and off', () => {
    const { onUpdateSettings } = renderSection();

    const panelRow = screen
      .getByText(NL.t('settings.display.panelsLabel'))
      .closest('.settings-row') as HTMLElement;
    fireEvent.click(within(panelRow).getByLabelText(NL.t('settings.display.panelFamily')));

    expect(onUpdateSettings).toHaveBeenCalledWith({
      displayPanels: { agenda: true, chores: true, family: false, weather: true },
    });
  });

  it('toggles reduced motion', () => {
    const { onUpdateSettings } = renderSection({ reducedMotion: false });

    fireEvent.click(checkboxIn(NL.t('settings.appearance.reducedMotionLabel')));

    expect(onUpdateSettings).toHaveBeenCalledWith({ reducedMotion: true });
  });

  it('reflects the stored panel selection', () => {
    renderSection({ displayPanels: { agenda: false, chores: true, family: false, weather: true } });

    const panelRow = screen
      .getByText(NL.t('settings.display.panelsLabel'))
      .closest('.settings-row');
    const checks = within(panelRow as HTMLElement).getAllByRole('checkbox') as HTMLInputElement[];

    expect(checks.map((check) => check.checked)).toEqual([false, true, false, true]);
  });
});
