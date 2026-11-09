import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { AppearanceSection } from './AppearanceSection';
import { I18nContext, createI18n } from '../../../i18n';
import { themes } from '../../../styles/themes';
import type { BeaconSettings } from '../../../hooks/useSettings';

/**
 * Appearance section.
 *
 * These cases pin the behaviour the section took out of `SettingsView`: the
 * theme grid (one card per theme plus the automatic entry, exactly one marked
 * active), the auto-dark-mode time window that only appears when enabled, and
 * the three segmented pickers.
 */

function makeSettings(overrides: Partial<BeaconSettings> = {}): BeaconSettings {
  return {
    themeId: 'skylight',
    autoDarkMode: true,
    darkModeStart: '21:00',
    darkModeEnd: '07:00',
    fontScale: 'normal',
    sidebarPosition: 'left',
    advancedDashboard: false,
    ...overrides,
  } as BeaconSettings;
}

function renderSection(overrides: Partial<BeaconSettings> = {}) {
  const onUpdateSettings = vi.fn();
  const t = createI18n('nl');
  const utils = render(
    <I18nContext.Provider value={t}>
      <AppearanceSection
        settings={makeSettings(overrides)}
        onUpdateSettings={onUpdateSettings}
        t={t.t}
      />
    </I18nContext.Provider>,
  );
  return { ...utils, onUpdateSettings, t };
}

describe('AppearanceSection', () => {
  it('renders one theme card per theme plus the automatic entry', () => {
    const { container } = renderSection();

    const cards = container.querySelectorAll('.settings-theme-card');
    expect(cards.length).toBe(themes.length + 1);
    expect(cards[0].textContent).toContain(createI18n('nl').t('settings.appearance.themeAuto'));
  });

  it('marks only the selected theme as active', () => {
    const { container } = renderSection({ themeId: 'nord' });

    const active = container.querySelectorAll('.settings-theme-card--active');
    expect(active.length).toBe(1);
    expect(active[0].textContent).toContain(themes.find((theme) => theme.id === 'nord')!.name);
  });

  it('updates both the setting and the applied theme when a theme is picked', () => {
    const { onUpdateSettings, container } = renderSection({ themeId: 'skylight' });

    const target = themes.find((theme) => theme.id === 'dracula')!;
    const card = Array.from(container.querySelectorAll('.settings-theme-card')).find((element) =>
      element.textContent?.includes(target.name),
    )!;
    fireEvent.click(card);

    expect(onUpdateSettings).toHaveBeenCalledWith({ themeId: 'dracula' });
    // useTheme persists the choice so a reload keeps the theme.
    expect(localStorage.getItem('beacon-theme')).toBe('dracula');
  });

  it('hides the dark-mode window while automatic dark mode is off', () => {
    renderSection({ autoDarkMode: false });

    expect(screen.queryByDisplayValue('21:00')).toBeNull();
    expect(screen.queryByDisplayValue('07:00')).toBeNull();
  });

  it('shows the dark-mode window and reports edits to it', () => {
    const { onUpdateSettings } = renderSection();

    const start = screen.getByDisplayValue('21:00');
    fireEvent.change(start, { target: { value: '22:30' } });
    expect(onUpdateSettings).toHaveBeenCalledWith({ darkModeStart: '22:30' });

    const end = screen.getByDisplayValue('07:00');
    fireEvent.change(end, { target: { value: '06:15' } });
    expect(onUpdateSettings).toHaveBeenCalledWith({ darkModeEnd: '06:15' });
  });

  it('toggles automatic dark mode', () => {
    const { onUpdateSettings, t } = renderSection({ autoDarkMode: true });

    const toggle = screen
      .getByText(t.t('settings.appearance.autoDarkModeLabel'))
      .closest('.settings-row')!
      .querySelector('input[type="checkbox"]')!;
    fireEvent.click(toggle);

    expect(onUpdateSettings).toHaveBeenCalledWith({ autoDarkMode: false });
  });

  it('reports font scale and sidebar position picks', () => {
    const { onUpdateSettings, t } = renderSection();

    fireEvent.click(screen.getByText(t.t('settings.appearance.fontLarge')));
    expect(onUpdateSettings).toHaveBeenCalledWith({ fontScale: 'large' });

    fireEvent.click(screen.getByText(t.t('settings.appearance.right')));
    expect(onUpdateSettings).toHaveBeenCalledWith({ sidebarPosition: 'right' });
  });

  it('reports the advanced dashboard toggle', () => {
    const { onUpdateSettings, t } = renderSection();

    const toggle = screen
      .getByText(t.t('settings.appearance.advancedDashboardLabel'))
      .closest('.settings-row')!
      .querySelector('input[type="checkbox"]')!;
    fireEvent.click(toggle);

    expect(onUpdateSettings).toHaveBeenCalledWith({ advancedDashboard: true });
  });
});
