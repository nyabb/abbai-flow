import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ChorePlanner } from './ChorePlanner';
import { I18nContext, createI18n } from '../i18n';
import { LOCALE_OPTIONS } from '../i18n/locales';
import type { FamilyMember } from '../types/family';

vi.mock('../hooks/useChoreOps', () => ({
  useChoreOps: () => ({
    data: null,
    loading: false,
    error: null,
    available: false,
    refresh: () => {},
    pressButton: async () => {},
    claimChore: async () => {},
    createChore: async () => {},
    updateChore: async () => {},
    createReward: async () => {},
    deleteChore: async () => {},
    approveReward: async () => {},
  }),
}));

const MEMBER: FamilyMember = {
  id: 'c1',
  name: 'Zara',
  avatar: '\u{1F642}',
  color: '#1f7a5a',
  role: 'child',
};

function renderPlanner(locale: string, onLocaleChange: (locale: string) => void) {
  return render(
    <I18nContext.Provider value={createI18n(locale)}>
      <ChorePlanner
        members={[MEMBER]}
        weather={null}
        nextAppointment={null}
        locale={locale}
        onLocaleChange={onLocaleChange}
      />
    </I18nContext.Provider>,
  );
}

describe('ChorePlanner language picker', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('offers every locale Beacon supports, exactly like Settings', () => {
    renderPlanner('nl', () => {});
    const select = screen.getByLabelText('Taal / Regio') as HTMLSelectElement;

    expect(Array.from(select.options).map((option) => option.value)).toEqual(
      LOCALE_OPTIONS.map((option) => option.value),
    );
    expect(select.value).toBe('nl');
  });

  it('reports the chosen locale so the whole app can switch language', () => {
    const onLocaleChange = vi.fn();
    renderPlanner('nl', onLocaleChange);

    fireEvent.change(screen.getByLabelText('Taal / Regio'), { target: { value: 'ja' } });

    expect(onLocaleChange).toHaveBeenCalledWith('ja');
  });

  it('renders its copy in whatever language the app is set to', () => {
    const { container, unmount } = renderPlanner('de', () => {});

    expect(container.textContent).toContain('Aufgaben & Routinen');
    unmount();

    const dutch = renderPlanner('nl', () => {});
    expect(dutch.container.textContent).toContain('Taakjes & Routines');
  });
});
