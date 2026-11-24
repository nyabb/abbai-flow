import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { DisplaySection } from '../settings/sections/DisplaySection';
import { I18nContext, createI18n } from '../../i18n';
import type { AbbaiSettings } from '../../hooks/useSettings';

/** The remaining Display settings include app-wide reduced-motion support. */
const NL = createI18n('nl');

function makeSettings(overrides: Partial<AbbaiSettings> = {}): AbbaiSettings {
  return {
    screenSaverEnabled: true,
    screenSaverMode: 'clock',
    dimTimeout: 5,
    screenSaverTimeout: 10,
    alwaysOnDisplay: false,
    showSeconds: false,
    kioskMode: false,
    reducedMotion: false,
    ...overrides,
  } as AbbaiSettings;
}

function renderSection(overrides: Partial<AbbaiSettings> = {}) {
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

describe('DisplaySection', () => {
  it('toggles reduced motion', () => {
    const { onUpdateSettings } = renderSection({ reducedMotion: false });

    fireEvent.click(checkboxIn(NL.t('settings.appearance.reducedMotionLabel')));

    expect(onUpdateSettings).toHaveBeenCalledWith({ reducedMotion: true });
  });
});
