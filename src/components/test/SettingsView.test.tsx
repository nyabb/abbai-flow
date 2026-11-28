import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsView } from '../SettingsView';
import { I18nContext, createI18n } from '../../i18n';
import type { AbbaiSettings } from '../../hooks/useSettings';
import type { FamilyMember } from '../../types/family';

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
    defaultView: 'calendar',
    timeFormat: '24h',
    weekStartsOn: 1,
    locale: 'nl',
    themeId: 'skylight',
    autoDarkMode: true,
    darkModeStart: '21:00',
    darkModeEnd: '07:00',
    fontScale: 'normal',
    defaultCalendar: '',
    permanentlyHiddenCalendars: [],
    calendarColors: {},
    defaultEventDuration: 60,
    notificationMinutes: 10,
    defaultGroceryList: '',
    groceryListIds: [],
    shoppingEntity: '',
    musicDefaultPlayer: '',
    photoDirectory: '/media/abbai-flow/photos',
    photoInterval: 30,
    photoTransition: 'fade',
    screenSaverEnabled: true,
    screenSaverMode: 'clock',
    dimTimeout: 5,
    screenSaverTimeout: 10,
    alwaysOnDisplay: false,
    showSeconds: false,
    reducedMotion: false,
    choresResetTime: '00:00',
    streakDays: 5,
    ...overrides,
  } as AbbaiSettings;
}

function renderSettings(
  overrides: Partial<AbbaiSettings> = {},
  calendars: Array<{ id: string; name: string; color?: string; readOnly?: boolean }> = [],
  members: FamilyMember[] = [],
) {
  const onUpdateSettings = vi.fn();
  const nl = createI18n('nl');
  const settings = makeSettings(overrides);
  const renderView = (
    calendarSources: Array<{ id: string; name: string; color?: string; readOnly?: boolean }>,
  ) => (
    <I18nContext.Provider value={nl}>
      <SettingsView
        settings={settings}
        onUpdateSettings={onUpdateSettings}
        onResetSettings={vi.fn()}
        onExportSettings={() => '{}'}
        onImportSettings={vi.fn()}
        onClearLocalStorage={vi.fn()}
        members={members}
        onAddMember={vi.fn()}
        onUpdateMember={vi.fn()}
        onRemoveMember={vi.fn()}
        connected={false}
        haUrl=""
        calendars={calendarSources}
        onEnterFocusMode={vi.fn()}
      />
    </I18nContext.Provider>
  );
  const utils = render(renderView(calendars));
  return {
    ...utils,
    onUpdateSettings,
    rerenderWithCalendars: (
      calendarSources: Array<{ id: string; name: string; color?: string; readOnly?: boolean }>,
    ) =>
      utils.rerender(renderView(calendarSources)),
  };
}

describe('SettingsView', () => {
  afterEach(() => vi.unstubAllGlobals());

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

  it('lists discovered CalDAV calendars in the calendar settings selector', () => {
    const { rerenderWithCalendars } = renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }));

    expect(screen.queryByRole('option', { name: 'Apple: Family' })).not.toBeInTheDocument();
    rerenderWithCalendars([{ id: 'caldav/apple/family', name: 'Apple: Family' }]);

    expect(screen.getByRole('option', { name: 'Apple: Family' })).toBeInTheDocument();
  });

  it('lists ICS feeds for visibility but excludes them from the default event destination', () => {
    const { rerenderWithCalendars, onUpdateSettings } = renderSettings();
    fireEvent.click(screen.getByRole('button', { name: 'Agenda' }));
    rerenderWithCalendars([
      { id: 'ics/school-feed', name: 'School feed', readOnly: true },
      { id: 'caldav/apple/family', name: 'Apple: Family' },
    ]);

    expect(screen.getByText('School feed')).toBeInTheDocument();
    const defaultCalendar = document.querySelector<HTMLSelectElement>('.settings-select');
    expect(defaultCalendar).not.toBeNull();
    expect(screen.queryByRole('option', { name: 'School feed' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Apple: Family' })).toBeInTheDocument();

    fireEvent.change(defaultCalendar!, { target: { value: 'caldav/apple/family' } });
    expect(onUpdateSettings).toHaveBeenCalledWith({ defaultCalendar: 'caldav/apple/family' });
  });

  it('requires a parent PIN before resetting ChoresMan data', async () => {
    const snapshot = {
      members: [],
      chores: [],
      chore_claims: [],
      rewards: [],
      reward_claims: [],
      ledger: [],
      pending_approvals: { chores: 0, rewards: 0 },
      updated_at: null,
    };
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ result: { reset: true }, snapshot }),
    });
    vi.stubGlobal('fetch', fetchMock);
    renderSettings({}, [], [{
      id: 'parent-1',
      name: 'Jamie',
      role: 'parent',
      avatar: '👩',
      color: '#336699',
      pin: '1234',
    }]);

    fireEvent.click(screen.getByRole('button', { name: 'Klusjes' }));
    fireEvent.click(screen.getByRole('button', { name: 'Alle gegevens resetten' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    const pinInput = screen.getByLabelText('Ouder-pincode');
    expect(pinInput).toHaveAttribute('inputmode', 'numeric');
    fireEvent.change(pinInput, { target: { value: '12x34' } });
    expect(pinInput).toHaveValue('1234');
    fireEvent.click(screen.getByRole('button', { name: 'Reset bevestigen' }));

    expect(await screen.findByRole('status')).toHaveTextContent('De ChoresMan-gegevens zijn gereset.');
    expect(fetchMock).toHaveBeenCalledWith('/abbai-flow/choresman', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ action: 'reset_all_data', data: { confirm_destructive: true } }),
    }));
  });
});
