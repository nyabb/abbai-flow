import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChoreBoard } from '../chore-planner/ChoreBoard';
import { I18nContext, createI18n } from '../../i18n';
import type { PlannerCopy } from '../chore-planner/copy';
import type { PlannerMember } from '../../api/chore-planner-model';

const NL = createI18n('nl');

/*
 * Only the keys the board actually reads are provided; the rest of PlannerCopy
 * belongs to sheets and rows that these tests never render.
 */
const copy = {
  title: 'Taakjes & Routines',
  choresColumn: 'Taakjes',
  routines: 'Routines',
  goals: 'Doelen',
  free: 'Vrij te pakken',
  nothing: 'Geen taakjes',
  noRoutines: 'Geen routines',
  add: 'Toevoegen',
  openChild: 'Openen',
  startMissions: 'Missies starten',
} as unknown as PlannerCopy;

const ZARA: PlannerMember = {
  id: 'c1',
  name: 'Zara',
  avatar: '\u{1F642}',
  color: '#1f7a5a',
  savings: 25,
};
const MAYA: PlannerMember = { ...ZARA, id: 'c2', name: 'Maya' };

function renderBoard() {
  return render(
    <I18nContext.Provider value={NL}>
      <ChoreBoard
        boardMembers={[ZARA, MAYA]}
        columnTasks={() => []}
        columnRoutines={() => []}
        canRunMissions={() => true}
        freeTasks={[]}
        spendableFor={() => 25}
        renderRow={() => null}
        routineRow={() => null}
        renderGoals={(memberId) => <span>doelen van {memberId}</span>}
        copy={copy}
        onOpenChild={() => {}}
        onOpenGoals={() => {}}
        onStartMissions={() => {}}
        onNewChore={() => {}}
      />
    </I18nContext.Provider>,
  );
}

const originalMatchMedia = window.matchMedia;

/** jsdom has no matchMedia, so a phone viewport has to be stubbed in. */
function phoneViewport() {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('ChoreBoard', () => {
  /* No matchMedia (jsdom, old browsers) means the wide board, so the default is
     unchanged for every existing caller. */
  it('shows every member side by side when the viewport is not a phone', () => {
    const { container } = renderBoard();

    // Two children plus the free-chore column.
    expect(container.querySelectorAll('.planner-col')).toHaveLength(3);
    expect(container.querySelector('.planner-board--compact')).toBeNull();
  });

  /*
   * A phone cannot fit four columns, so it gets one member at a time with the
   * reference app's tab row instead.
   */
  it('switches to one member with a tab row on a phone viewport', () => {
    phoneViewport();
    const { container } = renderBoard();

    expect(container.querySelector('.planner-board--compact')).not.toBeNull();
    expect(container.querySelectorAll('.planner-col')).toHaveLength(0);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    // Every avatar sits in the sized chip, so an uploaded photo cannot render at
    // its original resolution inside the switcher button.
    expect(
      container.querySelectorAll('.planner-mobile-member .planner-mobile-avatar'),
    ).toHaveLength(2);
    // The first member is selected when nothing else has been picked. (The
    // phone toolbar's mission button is also named after the member, so the
    // chip is targeted by class rather than by accessible name.)
    expect(
      container.querySelector('.planner-mobile-member.is-active .planner-mobile-name')?.textContent,
    ).toBe('Zara');
  });

  it('shows one tab at a time and switches between them', () => {
    phoneViewport();
    const { container } = renderBoard();

    // Chores first: empty, because the fixture has none.
    expect(container.querySelector('.planner-mobile-panel')?.textContent).toContain('Geen taakjes');

    fireEvent.click(screen.getByRole('tab', { name: /Doelen/ }));
    expect(container.querySelector('.planner-mobile-panel')?.textContent).toContain(
      'doelen van c1',
    );

    fireEvent.click(screen.getByRole('tab', { name: /Routines/ }));
    expect(container.querySelector('.planner-mobile-panel')?.textContent).toContain(
      'Geen routines',
    );
  });

  it('switches the member the tabs are about', () => {
    phoneViewport();
    const { container } = renderBoard();

    fireEvent.click(screen.getByRole('button', { name: /Maya/ }));
    fireEvent.click(screen.getByRole('tab', { name: /Doelen/ }));

    expect(container.querySelector('.planner-mobile-panel')?.textContent).toContain(
      'doelen van c2',
    );
  });
});
