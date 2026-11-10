import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ChorePlanner } from '../ChorePlanner';
import { I18nContext, createI18n } from '../../i18n';
import type { FamilyMember } from '../../types/family';
import type { ChoreOpsState } from '../../types/choreops';

const mocks = vi.hoisted(() => ({
  approveReward: vi.fn(async () => {}),
  state: { current: null as ChoreOpsState | null },
}));

vi.mock('../../hooks/useChoreOps', () => ({
  useChoreOps: () => ({
    data: mocks.state.current,
    loading: false,
    error: null,
    available: true,
    refresh: () => {},
    pressButton: async () => {},
    claimChore: async () => {},
    createChore: async () => {},
    updateChore: async () => {},
    createReward: async () => {},
    deleteReward: async () => {},
    deleteChore: async () => {},
    approveReward: mocks.approveReward,
  }),
}));

function member(overrides: Partial<FamilyMember>): FamilyMember {
  return {
    id: 'member-1',
    name: 'Member',
    avatar: '\u{1F642}',
    color: '#1f7a5a',
    role: 'child',
    ...overrides,
  };
}

const PARENT = member({ id: 'p1', name: 'Papa', role: 'parent', pin: '0123' });
const ZARA = member({ id: 'c1', name: 'Zara', choreops_user: 'Zara' });

function state(): ChoreOpsState {
  return {
    users: [
      {
        name: 'Zara',
        slug: 'zara',
        points: 25,
        dueToday: 0,
        claimed: 0,
        approved: 0,
        completedToday: 0,
      },
    ],
    chores: [],
    rewards: [
      {
        id: 'sensor.zara_choreops_reward_status_schermtijd',
        name: 'Schermtijd',
        status: 'available',
        cost: 20,
        pendingClaims: 0,
        assignee: 'Zara',
        actions: { claim: 'button.zara_redeem_schermtijd' },
      },
    ],
    people: [],
    pointsByUser: { zara: 25 },
    pendingApprovals: { chores: 0, rewards: 0 },
    entryId: 'entry-1',
    available: true,
  };
}

const NL = createI18n('nl');

function renderPlanner(members: FamilyMember[]) {
  return render(
    <I18nContext.Provider value={NL}>
      <ChorePlanner members={members} locale="nl" onLocaleChange={() => {}} />
    </I18nContext.Provider>,
  );
}

function openRewards(container: HTMLElement) {
  const col = [...container.querySelectorAll<HTMLElement>('.planner-col')].find((element) =>
    element.querySelector('.planner-col-head strong')?.textContent?.includes('Zara'),
  )!;
  fireEvent.click(col.querySelector<HTMLButtonElement>('.planner-col-points')!);
}

function rewardRow(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>('.planner-reward')].find((element) =>
    element.textContent?.includes('Schermtijd'),
  )!;
}

describe('reward lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.approveReward.mockClear();
    mocks.state.current = state();
  });

  it('moves from saving to achieved, then parent-given, then pursuable again', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    // 1. The child saves towards the goal.
    fireEvent.click(screen.getByRole('button', { name: 'Toewijzen' }));
    await waitFor(() => expect(container.textContent).toContain('Wacht op beloning'));
    expect(container.textContent).toContain('20 / 20');
    // Nothing has been handed over, so ChoreOps was not touched.
    expect(mocks.approveReward).not.toHaveBeenCalled();

    // 2. The parent's queue lists it, and handing it over asks for the PIN.
    fireEvent.click(
      within(container.querySelector<HTMLElement>('.planner-sheet')!).getByRole('button', {
        name: 'Beloning als gegeven markeren',
      }),
    );
    const pin = container.querySelector<HTMLInputElement>('.planner-pin-input')!;
    expect(pin).not.toBeNull();
    fireEvent.change(pin, { target: { value: '0123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ontgrendelen' }));

    // 3. ChoreOps deducts exactly once; Beacon records who gave it.
    await waitFor(() => expect(mocks.approveReward).toHaveBeenCalledTimes(1));
    expect(mocks.approveReward).toHaveBeenCalledWith('Zara', 'Schermtijd', 'Papa');
    await waitFor(() => expect(container.textContent).toContain('Beloning gegeven'));

    // 4. It leaves the active goals (back to a plain assignable goal) but the
    //    history and the reward definition both survive.
    await waitFor(() => {
      const row = rewardRow(container);
      expect(row.textContent).not.toContain('Wacht op beloning');
      expect(within(row).getByRole('button', { name: 'Toewijzen' })).toBeTruthy();
    });
    expect(container.textContent).toContain('Beloning gegeven');

    // 5. The same reward can be pursued again.
    fireEvent.click(screen.getByRole('button', { name: 'Toewijzen' }));
    await waitFor(() => expect(container.textContent).toContain('Wacht op beloning'));
    expect(mocks.approveReward).toHaveBeenCalledTimes(1);
  });

  it('does not let the child hand a reward over', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    fireEvent.click(screen.getByRole('button', { name: 'Toewijzen' }));
    await waitFor(() => expect(container.textContent).toContain('Wacht op beloning'));

    // The only path to "given" is the PIN-gated parent action.
    const sheet = container.querySelector<HTMLElement>('.planner-sheet')!;
    const giveButtons = within(sheet)
      .getAllByRole('button')
      .filter((button) => button.textContent?.includes('gegeven'));
    expect(giveButtons).toHaveLength(1);

    fireEvent.click(giveButtons[0]);
    expect(container.querySelector('.planner-pin-input')).not.toBeNull();
    expect(mocks.approveReward).not.toHaveBeenCalled();
  });
});
