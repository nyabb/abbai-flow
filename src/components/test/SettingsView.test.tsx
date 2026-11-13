import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsView } from '../SettingsView';
import { I18nContext, createI18n } from '../../i18n';
import type { AbbaiSettings } from '../../hooks/useSettings';

/**
 * Smoke coverage for the settings screen.
 *
 * Settings is the one screen with no tests, which made any refactor of its
 * 2000 lines a blind change. These cases pin the parts a split must not break:
 * the section navigation, the props wiring of a toggle, and that every section
 * renders without throwing.
 */

function makeSettings(overrides: Partial<AbbaiSettings> = {}): AbbaiSettings {
  return {
    familyName: 'Sachshaus',
    saveConfigInBrowser: true,
    defaultView: 'dashboard',
    timeFormat: '24h',
    weekStartsOn: 1,
    locale: 'nl',
    themeId: 'skylight',
    autoDarkMode: true,
    darkModeStart: '21:00',
    darkModeEnd: '07:00',
    fontScale: 'normal',
    sidebarPosition: 'left',
    defaultCalendar: '',
    permanentlyHiddenCalendars: [],
    calendarColors: {},
    defaultEventDuration: 60,
    notificationMinutes: 10,
    weatherEntity: 'weather.home',
    grocyEnabled: false,
    anylistEnabled: false,
    defaultGroceryList: '',
    groceryListIds: [],
    shoppingEntity: '',
    musicDefaultPlayer: '',
    photoDirectory: '/media/beacon/photos',
    photoInterval: 30,
    photoTransition: 'fade',
    dashboardLayout: 'default',
    advancedDashboard: false,
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
    choresEnabled: true,
    choresResetTime: '00:00',
    streakDays: 5,
    ...overrides,
  } as AbbaiSettings;
}

function renderSettings(overrides: Partial<AbbaiSettings> = {}) {
  const onUpdateSettings = vi.fn();
  const nl = createI18n('nl');
  const utils = render(
    <I18nContext.Provider value={nl}>
      <SettingsView
        settings={makeSettings(overrides)}
        onUpdateSettings={onUpdateSettings}
        onResetSettings={vi.fn()}
        onExportSettings={() => '{}'}
        onImportSettings={vi.fn()}
        onClearLocalStorage={vi.fn()}
        members={[]}
        onAddMember={vi.fn()}
        onUpdateMember={vi.fn()}
        onRemoveMember={vi.fn()}
        connected={false}
        haUrl=""
        calendars={[]}
        onEnterFocusMode={vi.fn()}
      />
    </I18nContext.Provider>,
  );
  return { ...utils, onUpdateSettings };
}

describe('SettingsView', () => {
  it('opens on General and lists every section in the navigation', () => {
    renderSettings();

    const nav = screen.getAllByRole('button');
    expect(nav.length).toBeGreaterThan(0);
    // The family name field belongs to the General section.
    expect(screen.getByDisplayValue('Sachshaus')).toBeInTheDocument();
  });

  it('renders every section without throwing', () => {
    renderSettings();

    const nav = document.querySelector('.settings-nav');
    expect(nav).not.toBeNull();
    const sections = Array.from(nav!.querySelectorAll('button'));
    expect(sections.length).toBeGreaterThanOrEqual(8);

    for (const button of sections) {
      expect(() => fireEvent.click(button)).not.toThrow();
    }
  });

  it('shows the build version in About', () => {
    renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Over' }));

    const versionRow = [...document.querySelectorAll<HTMLElement>('.settings-about-row')].find(
      (row) => row.querySelector('.settings-about-label')?.textContent === 'Versie',
    );
    expect(versionRow?.querySelector('.settings-about-value')?.textContent).toBe(__APP_VERSION__);
  });

  it('passes a control change through to the settings updater', () => {
    const { onUpdateSettings } = renderSettings();

    const input = screen.getByDisplayValue('Sachshaus');
    fireEvent.change(input, { target: { value: 'Nieuwe naam' } });

    expect(onUpdateSettings).toHaveBeenCalled();
  });
});
