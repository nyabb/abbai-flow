import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ChorePlanner } from '../ChorePlanner';
import { I18nContext, createI18n } from '../../i18n';
import type { FamilyMember } from '../../types/family';
import type { ChoreOpsState } from '../../types/choreops';

const mocks = vi.hoisted(() => ({
  approveReward: vi.fn(async () => {}),
  deleteReward: vi.fn(async () => {}),
  fetchRewardHistory: vi.fn(async () => [] as Array<{
    id: string;
    timestamp: string;
    timestampMs: number;
    amount: number;
    balanceAfter: number | null;
    itemName: string;
    referenceId: string | null;
  }>),
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
    updateReward: async () => {},
    deleteReward: mocks.deleteReward,
    deleteChore: async () => {},
    approveReward: mocks.approveReward,
  }),
}));

vi.mock('../../api/choreops-ledger', () => ({
  fetchChoreOpsRewardHistory: mocks.fetchRewardHistory,
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
    chores: [
      {
        id: 'status:zara::afwassen',
        name: 'Afwassen',
        icon: null,
        status: 'pending',
        assignee: 'Zara',
        points: 0,
        dueDate: null,
        canClaim: true,
        canApprove: false,
        actions: { claim: 'button.zara_claim_afwassen' },
      },
    ],
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

function rewardRow(container: HTMLElement, name = 'Schermtijd') {
  return [...container.querySelectorAll<HTMLElement>('.planner-reward')].find((element) =>
    element.textContent?.includes(name),
  )!;
}

/**
 * Complete a chore and choose an explicit amount in the "Punten verdelen"
 * sheet. The reward row intentionally has no Assign button: points reach a
 * goal through the award sheet after a chore is ticked.
 */
function assign(container: HTMLElement, name: string, amount: number) {
  const backdrop = container.querySelector<HTMLElement>('.planner-backdrop');
  if (backdrop) fireEvent.click(backdrop);

  fireEvent.click(container.querySelector<HTMLButtonElement>('.planner-row-check')!);
  fireEvent.click(screen.getByRole('button', { name: 'Bevestigen' }));

  const award = container.querySelector<HTMLElement>('.planner-sheet')!;
  fireEvent.click(
    within(award)
      .getAllByRole('button')
      .find((button) => button.textContent?.includes(name))!,
  );

  const sheet = container.querySelector<HTMLElement>('.planner-sheet')!;
  fireEvent.change(within(sheet).getByRole('spinbutton'), { target: { value: String(amount) } });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Toewijzen', exact: true }));
  openRewards(container);
}

/** Parent approves the payout from the funded reward row. */
async function approvePayout(container: HTMLElement, name = 'Schermtijd') {
  fireEvent.click(
    within(rewardRow(container, name)).getByRole('button', {
      name: 'Beloning goedkeuren',
      exact: true,
    }),
  );
  const pin = container.querySelector<HTMLInputElement>('.planner-pin-input')!;
  expect(pin).not.toBeNull();
  fireEvent.change(pin, { target: { value: '0123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Ontgrendelen' }));
  await waitFor(() => expect(container.textContent).toContain('Beloning gegeven'));
}

describe('reward lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.approveReward.mockClear();
    mocks.deleteReward.mockClear();
    mocks.fetchRewardHistory.mockReset();
    mocks.fetchRewardHistory.mockResolvedValue([]);
    mocks.state.current = state();
  });

  it('shows ChoreOps reward transactions in the reward history', async () => {
    mocks.fetchRewardHistory.mockResolvedValue([
      {
        id: 'ledger-1',
        timestamp: '2026-11-12T18:30:00Z',
        timestampMs: Date.parse('2026-11-12T18:30:00Z'),
        amount: -20,
        balanceAfter: 5,
        itemName: 'Schermtijd',
        referenceId: 'ledger-1',
      },
    ]);
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    await waitFor(() => expect(container.textContent).toContain('Schermtijd'));
    expect(container.textContent).toContain('Gegeven beloningen');
    expect(container.textContent).toContain('20 punten');
    expect(mocks.fetchRewardHistory).toHaveBeenCalledWith('Zara');
  });

  it('filters the reward history by a rolling date range', async () => {
    const now = Date.now();
    mocks.fetchRewardHistory.mockResolvedValue([
      {
        id: 'recent',
        timestamp: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        timestampMs: now - 24 * 60 * 60 * 1000,
        amount: -5,
        balanceAfter: 20,
        itemName: 'Recent reward',
        referenceId: 'recent',
      },
      {
        id: 'older',
        timestamp: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
        timestampMs: now - 3 * 24 * 60 * 60 * 1000,
        amount: -10,
        balanceAfter: 15,
        itemName: 'Older reward',
        referenceId: 'older',
      },
    ]);
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);
    await waitFor(() => expect(container.textContent).toContain('Older reward'));

    const historyNames = () =>
      [...container.querySelectorAll('.planner-sheet .planner-reward--done strong')].map(
        (item) => item.textContent,
      );
    const sheet = container.querySelector<HTMLElement>('.planner-sheet')!;
    const range = within(sheet).getByLabelText('Periode');

    fireEvent.change(range, { target: { value: 'twoDays' } });
    expect(historyNames()).toEqual(['Recent reward']);

    fireEvent.change(range, { target: { value: 'week' } });
    expect(historyNames()).toEqual(['Recent reward', 'Older reward']);

    fireEvent.change(range, { target: { value: 'all' } });
    expect(historyNames()).toEqual(['Recent reward', 'Older reward']);
  });

  it('saves an explicit amount, asks a parent to pay out, then resets for reuse', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    // 1. The child explicitly chooses how much to put towards the goal.
    assign(container, 'Schermtijd', 20);
    await waitFor(() => expect(container.textContent).toContain('Wacht op beloning'));
    expect(container.textContent).toContain('20 / 20');
    // Nothing has been handed over, so ChoreOps was not touched.
    expect(mocks.approveReward).not.toHaveBeenCalled();

    // 2. Paying out is the parent's approval, and it asks for the PIN.
    await approvePayout(container);
    expect(mocks.approveReward).toHaveBeenCalledTimes(1);
    expect(mocks.approveReward).toHaveBeenCalledWith('Zara', 'Schermtijd', 'Papa');

    // 3. The prompt offers reuse or delete; reuse puts the goal back at zero.
    fireEvent.click(screen.getByRole('button', { name: 'Opnieuw gebruiken' }));
    openRewards(container);
    await waitFor(() => expect(container.textContent).toContain('0 / 20'));
    expect(container.textContent).toContain('Beloning teruggezet met 0 punten');
    expect(mocks.deleteReward).not.toHaveBeenCalled();

    // 4. The same reward can be pursued again.
    assign(container, 'Schermtijd', 20);
    await waitFor(() => expect(container.textContent).toContain('Wacht op beloning'));
    expect(mocks.approveReward).toHaveBeenCalledTimes(1);
  });

  it('leaves other goals untouched when points are split', async () => {
    mocks.state.current = {
      ...state(),
      rewards: [
        ...state().rewards,
        {
          id: 'sensor.zara_choreops_reward_status_snack',
          name: 'Snack',
          status: 'available',
          cost: 10,
          pendingClaims: 0,
          assignee: 'Zara',
          actions: { claim: 'button.zara_redeem_snack' },
        },
      ],
    };
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    assign(container, 'Schermtijd', 7);
    await waitFor(() => expect(rewardRow(container, 'Schermtijd').textContent).toContain('7 / 20'));
    assign(container, 'Snack', 3);
    await waitFor(() => expect(rewardRow(container, 'Snack').textContent).toContain('3 / 10'));
    // 25 points minus the 10 promised leaves 15 spendable on the board.
    expect(container.querySelector('.planner-col-points')?.textContent).toContain('15');
  });

  it('deletes the reward when the parent chooses delete after payout', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    assign(container, 'Schermtijd', 20);
    await waitFor(() => expect(container.textContent).toContain('Wacht op beloning'));
    await approvePayout(container);
    fireEvent.click(screen.getByRole('button', { name: 'Verwijderen' }));

    await waitFor(() => expect(mocks.deleteReward).toHaveBeenCalledTimes(1));
    expect(mocks.deleteReward).toHaveBeenCalledWith('Schermtijd');
  });

  it('does not let the child hand a reward over', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    assign(container, 'Schermtijd', 20);
    await waitFor(() => expect(container.textContent).toContain('Wacht op beloning'));

    // Paying out is the only path to "given" and it always asks for the PIN.
    fireEvent.click(
      within(rewardRow(container)).getByRole('button', {
        name: 'Beloning goedkeuren',
        exact: true,
      }),
    );
    expect(container.querySelector('.planner-pin-input')).not.toBeNull();
    expect(mocks.approveReward).not.toHaveBeenCalled();
  });
});
