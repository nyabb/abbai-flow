import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ClockWeatherCard } from '../cards/ClockWeatherCard';
import { createI18n, I18nContext } from '../../i18n';
import type { DashboardCardContext } from '../../types/dashboard-cards';

describe('ClockWeatherCard', () => {
  it('shows the global language control in the dashboard topbar', () => {
    const context = {
      now: new Date('2026-11-22T12:00:00'),
      timeFormat: '24h',
      weather: null,
      selectedDate: new Date('2026-11-22T12:00:00'),
      isViewingToday: true,
      goToPreviousDay: vi.fn(),
      goToNextDay: vi.fn(),
      goToToday: vi.fn(),
    } as unknown as DashboardCardContext;

    render(
      <I18nContext.Provider value={createI18n('en-US', vi.fn())}>
        <ClockWeatherCard config={{}} context={context} />
      </I18nContext.Provider>,
    );

    expect(screen.getByRole('combobox', { name: 'Language / Locale' })).toBeInTheDocument();
  });
});
