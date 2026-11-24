import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { ChorePlanner } from '../ChorePlanner';
import { I18nContext, createI18n } from '../../i18n';
import type { FamilyMember } from '../../types/family';
import type { ChoreOpsState } from '../../types/choreops';

const mocks = vi.hoisted(() => ({
  createReward: vi.fn(async () => {}),
  deleteReward: vi.fn(async () => {}),
  deleteChore: vi.fn(async () => {}),
  approveReward: vi.fn(async () => {}),
  pressButton: vi.fn(async () => {}),
  fetchChoreHistory: vi.fn(
    async () =>
      [] as Array<{
        id: string;
        entityId: string;
        choreName: string;
        completedAt: string;
        completedAtMs: number;
        points: number | null;
      }>,
  ),
  state: { current: null as ChoreOpsState | null },
}));

vi.mock('../../hooks/useChoreOps', () => ({
  useChoreOps: () => ({
    data: mocks.state.current,
    loading: false,
    error: null,
    available: true,
    refresh: () => {},
    pressButton: mocks.pressButton,
    claimChore: async () => {},
    createChore: async () => {},
    updateChore: async () => {},
    createReward: mocks.createReward,
    deleteReward: mocks.deleteReward,
    deleteChore: mocks.deleteChore,
    approveReward: mocks.approveReward,
  }),
}));

vi.mock('../../api/choreops-chore-history', () => ({
  fetchChoreOpsChoreHistory: mocks.fetchChoreHistory,
}));

function makeMember(overrides: Partial<FamilyMember>): FamilyMember {
  return {
    id: 'member-1',
    name: 'Member',
    avatar: '\u{1F642}',
    color: '#1f7a5a',
    role: 'child',
    ...overrides,
  };
}

const PARENT = makeMember({ id: 'p1', name: 'Papa', role: 'parent', pin: '0123' });
const ZARA = makeMember({ id: 'c1', name: 'Zara', choreops_user: 'Zara' });

/** Minimal ChoreOps snapshot: one claimable chore and one reward for Zara. */
function choreOpsState(overrides: Partial<ChoreOpsState> = {}): ChoreOpsState {
  return {
    users: [
      {
        name: 'Zara',
        slug: 'zara',
        points: 25,
        dueToday: 1,
        claimed: 0,
        approved: 0,
        completedToday: 0,
      },
    ],
    chores: [
      {
        id: 'status:zara::afwassen',
        statusEntityId: 'sensor.zara_choreops_chore_status_afwassen',
        name: 'Afwassen',
        icon: 'mdi:silverware',
        status: 'pending',
        assignee: 'Zara',
        assignedUserNames: ['Zara'],
        completionCriteria: 'independent',
        points: 3,
        dueDate: null,
        canClaim: true,
        canApprove: false,
        actions: { claim: 'button.zara_choreops_claim_chore_afwassen' },
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
    ...overrides,
  };
}

/**
 * The planner takes its copy from the shared i18n dictionary. These tests pin
 * the Dutch locale so the assertions stay readable while still exercising the
 * real `useTranslation` path.
 */
const NL = createI18n('nl');

function renderPlanner(
  members: FamilyMember[],
  createRequest?: { kind: 'chore' | 'routine'; token: number },
) {
  return render(
    <I18nContext.Provider value={NL}>
      <ChorePlanner
        members={members}
        locale="nl"
        onLocaleChange={() => {}}
        createRequest={createRequest}
      />
    </I18nContext.Provider>,
  );
}

/** The column for one child, or the free-to-claim column. */
function column(container: HTMLElement, name: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('.planner-col')].find((element) =>
    element.querySelector('.planner-col-head strong')?.textContent?.includes(name),
  );
  return found!;
}

const freeColumn = (container: HTMLElement) => column(container, 'Vrij te pakken');

/** Open the actions sheet of the first chore row. */
function openFirstTaskActions(container: HTMLElement): boolean {
  const more = container.querySelector<HTMLButtonElement>('.planner-row-more');
  if (!more) return false;
  fireEvent.click(more);
  return Boolean(container.querySelector('.planner-destination.planner-danger'));
}

/** The goals sheet of one child opens from their points badge. */
function openRewards(container: HTMLElement, name = 'Zara') {
  fireEvent.click(column(container, name).querySelector<HTMLButtonElement>('.planner-col-points')!);
}

describe('ChorePlanner parent PIN gate', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.state.current = choreOpsState();
    mocks.createReward.mockClear();
    mocks.deleteChore.mockClear();
  });

  it('asks for a parent PIN before deleting a chore', () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    expect(openFirstTaskActions(container)).toBe(true);

    expect(container.querySelector('.planner-pin-input')).toBeNull();
    fireEvent.click(container.querySelector('.planner-destination.planner-danger')!);

    expect(container.querySelector('.planner-pin-input')).not.toBeNull();
    expect(mocks.deleteChore).not.toHaveBeenCalled();
  });

  it('rejects a wrong PIN and only then deletes', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openFirstTaskActions(container);
    fireEvent.click(container.querySelector('.planner-destination.planner-danger')!);

    const input = container.querySelector<HTMLInputElement>('.planner-pin-input')!;
    fireEvent.change(input, { target: { value: '9999' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ontgrendelen' }));

    expect(container.querySelector('.planner-validation')).not.toBeNull();
    expect(mocks.deleteChore).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '0123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ontgrendelen' }));

    await waitFor(() => expect(mocks.deleteChore).toHaveBeenCalledWith('Afwassen'));
  });

  it('keeps ChoreOps routine labels in chores and lists Abbai Flow routines separately', async () => {
    const base = choreOpsState();
    mocks.state.current = {
      ...base,
      chores: [
        {
          ...base.chores[0],
          frequency: 'daily',
          labels: ['Ochtendroutine'],
        },
      ],
    };
    const { container } = renderPlanner([PARENT, ZARA]);

    fireEvent.click(container.querySelector<HTMLButtonElement>('.planner-add')!);
    const sheet = container.querySelector<HTMLElement>('.planner-sheet')!;

    expect(within(sheet).getByText('Afwassen')).toBeTruthy();
    expect(sheet.textContent).toContain('Zara');

    fireEvent.click(within(sheet).getByRole('tab', { name: /Beloningen/ }));
    expect(within(sheet).getByText('Schermtijd')).toBeTruthy();

    fireEvent.click(within(sheet).getByRole('tab', { name: /Routines/ }));
    expect(within(sheet).queryByText('Ochtendroutine')).toBeNull();
    expect(within(sheet).getByText(NL.t('planner.noRoutines'))).toBeTruthy();
  });
});

/**
 * A chore anybody may take looks different until somebody takes it: it says so
 * in the chip and offers a hand to grab it. Once claimed it must read exactly
 * like a chore assigned to the child who took it, and it must be gone from the
 * other children's boards.
 */
/**
 * A chore anybody may take sits in its own column on the board. Once a child
 * claims it ChoreOps hands the row to that child, so it moves into their column
 * and nobody sees it twice.
 */
describe('ChorePlanner anyone chores', () => {
  const MAYA = makeMember({ id: 'c2', name: 'Maya', choreops_user: 'Maya' });

  /** Two children sharing a `shared_first` chore, one row per child. */
  function anyoneState(zaraStatus: string, mayaStatus: string): ChoreOpsState {
    const base = choreOpsState();
    const row = (name: string, status: string) => ({
      id: `status:${name.toLowerCase()}::tafel dekken`,
      statusEntityId: `sensor.${name.toLowerCase()}_choreops_chore_status_tafel_dekken`,
      name: 'Tafel dekken',
      icon: 'mdi:silverware',
      status,
      assignee: name,
      points: 5,
      dueDate: null,
      completionCriteria: 'shared_first',
      assignedUserNames: ['Maya', 'Zara'],
      canClaim: true,
      canApprove: false,
      actions: {
        claim: `button.${name.toLowerCase()}_choreops_claim_chore_tafel_dekken`,
      },
    });

    return {
      ...base,
      users: [
        { ...base.users[0], name: 'Maya', slug: 'maya', points: 10 },
        { ...base.users[0], name: 'Zara', slug: 'zara', points: 25 },
      ],
      chores: [row('Zara', zaraStatus), row('Maya', mayaStatus)],
    };
  }

  beforeEach(() => {
    localStorage.clear();
  });

  it('labels an unclaimed chore as anyone and offers a hand to take it', () => {
    mocks.state.current = anyoneState('pending', 'pending');
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);
    const free = freeColumn(container);

    expect(free.querySelectorAll('.planner-row')).toHaveLength(1);
    expect(free.querySelector('.planner-row--anyone')).not.toBeNull();
    expect(free.textContent).toContain('Tafel dekken');
    // The row's accessible name is "<action>: <chore>", so match on the verb.
    expect(within(free).getByRole('button', { name: /^Pakken: / })).toBeTruthy();
    // The children's own columns stay empty: nobody owns it yet.
    expect(column(container, 'Zara').querySelectorAll('.planner-row')).toHaveLength(0);
  });

  it('tells the child it waits for a parent once a free chore is claimed', () => {
    mocks.state.current = anyoneState('claimed', 'pending');
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);
    const labels = [...container.querySelectorAll('.planner-row-check')].map(
      (button) => button.getAttribute('aria-label') ?? '',
    );

    // Zara claimed it, so her row says a parent still has to sign off; the free
    // column still shows it for Maya. Nobody may claim it is finished, and the
    // child is never offered the approval itself.
    expect(labels.some((text) => text.startsWith('Wacht op goedkeuring'))).toBe(true);
    expect(labels.some((text) => text.startsWith('Afgerond'))).toBe(false);
    expect(labels.some((text) => text.startsWith('Bevestigen'))).toBe(false);
  });

  it('moves the chore into the claimer’s column, out of the free column', () => {
    mocks.state.current = anyoneState('claimed', 'completed_by_other');
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);

    const zara = column(container, 'Zara');
    expect(zara.querySelectorAll('.planner-row')).toHaveLength(1);
    expect(zara.textContent).toContain('Tafel dekken');
    // Maya is relieved of it, and it is no longer up for grabs.
    expect(column(container, 'Maya').querySelectorAll('.planner-row')).toHaveLength(0);
    expect(freeColumn(container).querySelectorAll('.planner-row')).toHaveLength(0);
  });
});

/**
 * Complete the (zero-point) chore, open the award sheet and choose an explicit
 * amount for the reward through the post-chore award sheet.
 */
async function assignReward(container: HTMLElement, amount: number) {
  const backdrop = container.querySelector<HTMLElement>('.planner-backdrop');
  if (backdrop) fireEvent.click(backdrop);

  fireEvent.click(container.querySelector<HTMLButtonElement>('.planner-row-check')!);
  fireEvent.click(screen.getByRole('button', { name: 'Bevestigen' }));

  const award = container.querySelector<HTMLElement>('.planner-sheet')!;
  fireEvent.click(
    within(award)
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('Schermtijd'))!,
  );

  const sheet = container.querySelector<HTMLElement>('.planner-sheet')!;
  fireEvent.change(within(sheet).getByRole('spinbutton'), { target: { value: String(amount) } });
  fireEvent.click(within(sheet).getByRole('button', { name: 'Toewijzen', exact: true }));
  await waitFor(() => expect(container.querySelector('.planner-backdrop')).toBeNull());
  openRewards(container);
}

describe('ChorePlanner rewards from ChoreOps', () => {
  beforeEach(() => {
    mocks.state.current = choreOpsState();
    mocks.createReward.mockClear();
    mocks.approveReward.mockClear();
    localStorage.clear();
  });

  it("shows a child's rewards on the chores board without opening their profile", () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    const zara = column(container, 'Zara');

    expect(zara.textContent).toContain('Afwassen');
    expect(zara.textContent).toContain('Schermtijd');
  });

  it('lists rewards and lets Zara allocate points already in her savings pot', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    expect(container.textContent).toContain('Schermtijd');
    expect(container.textContent).toContain('20 punten');
    const row = [...container.querySelectorAll<HTMLElement>('.planner-reward')].find((element) =>
      element.textContent?.includes('Schermtijd'),
    )!;
    fireEvent.click(within(row).getByRole('button', { name: 'Toewijzen' }));

    const sheet = container.querySelector<HTMLElement>('.planner-sheet')!;
    expect(sheet.textContent).toContain('Spaarpot');
    expect(sheet.textContent).toContain('25');
    const amount = within(sheet).getByRole('spinbutton');
    expect(amount.getAttribute('max')).toBe('20');
    fireEvent.change(amount, { target: { value: '10' } });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Toewijzen', exact: true }));

    await waitFor(() =>
      expect(localStorage.getItem('abbai-flow-reward-redemptions')).toContain('"points":10'),
    );
    openRewards(container);
    const updatedRow = [...container.querySelectorAll<HTMLElement>('.planner-reward')].find(
      (element) => element.textContent?.includes('Schermtijd'),
    )!;
    expect(updatedRow.textContent).toContain('10 / 20');
    expect(column(container, 'Zara').querySelector('.planner-col-points')?.textContent).toContain(
      '15',
    );
  });

  /*
   * Points leave the child's balance the moment they allocate, and the hold is
   * Abbai Flow-local: no parent confirmation, nothing written to ChoreOps, so the
   * child can take it back whenever they like.
   */
  /*
   * Allocating is the child's own action, and reaching the cost only means the
   * goal is achieved — the reward itself still has to be handed over by a
   * parent. The pursuit is stored in the shared Abbai Flow document, not in this
   * device's localStorage reservations.
   */
  it('marks the goal achieved on assign, and never writes to ChoreOps yet', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    await assignReward(container, 20);

    await waitFor(() => expect(container.textContent).toContain('Wacht op beloning'));
    expect(container.textContent).toContain('20 / 20');
    await waitFor(() =>
      expect(localStorage.getItem('abbai-flow-reward-redemptions')).toContain('schermtijd'),
    );
    // A reached goal is not a given reward: no ChoreOps deduction happened.
    expect(mocks.approveReward).not.toHaveBeenCalled();
  });

  /* Allocation never needs a parent: no PIN sheet and no ChoreOps write. */
  it('never asks a parent to approve an allocation', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    await assignReward(container, 20);

    await waitFor(() => expect(container.textContent).toContain('Wacht op beloning'));
    expect(container.querySelector('.planner-pin-input')).toBeNull();
    expect(mocks.approveReward).not.toHaveBeenCalled();
  });

  /* Points accumulate: a goal bigger than the balance stays open, partway. */
  it('accumulates points towards a goal instead of reserving the whole cost', async () => {
    const base = choreOpsState();
    mocks.state.current = { ...base, rewards: [{ ...base.rewards[0], cost: 40 }] };
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    await assignReward(container, 25);

    // Zara has 25 and the goal wants 40, so the explicit 25 stays open.
    await waitFor(() => expect(container.textContent).toContain('25 / 40'));
    expect(container.textContent).not.toContain('Gereserveerd');
  });

  /*
   * Deleting a reward definition is a parent decision even when a child has
   * reached it: the reward may be shared, and the goal is waiting to be given.
   */
  it('asks for a parent PIN before deleting a fully funded reward', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    await assignReward(container, 20);
    await waitFor(() => expect(container.textContent).toContain('Wacht op beloning'));

    const row = [...container.querySelectorAll<HTMLElement>('.planner-reward')].find((element) =>
      element.textContent?.includes('Schermtijd'),
    )!;
    fireEvent.click(row.querySelector('.planner-task-more')!);
    fireEvent.click(container.querySelector('.planner-sheet .planner-danger')!);

    expect(container.querySelector('.planner-pin-input')).not.toBeNull();
    expect(mocks.deleteReward).not.toHaveBeenCalled();
  });

  it('creates a per-child reward in ChoreOps', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    const goalsSheet = container.querySelector<HTMLElement>('.planner-sheet')!;
    fireEvent.click(within(goalsSheet).getByRole('button', { name: /Stel een doel in/ }));

    const nameInput = container.querySelectorAll<HTMLInputElement>('.planner-field input')[0];
    const costInput = container.querySelectorAll<HTMLInputElement>('.planner-field input')[1];
    fireEvent.change(nameInput, { target: { value: 'Naar de film' } });
    fireEvent.change(costInput, { target: { value: '40' } });

    // The child whose page we are on is already selected in the picker.
    const selected = container.querySelectorAll('.planner-member-picker button.is-selected');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('Zara');

    fireEvent.click(screen.getByRole('button', { name: 'Opslaan' }));

    // Creating a reward is a parent action, so the PIN comes first.
    const pin = container.querySelector<HTMLInputElement>('.planner-pin-input')!;
    fireEvent.change(pin, { target: { value: '0123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ontgrendelen' }));

    await waitFor(() =>
      expect(mocks.createReward).toHaveBeenCalledWith({
        name: 'Naar de film',
        cost: 40,
        assignedUserNames: ['Zara'],
      }),
    );
  });

  it('creates a reward for a child from the header create menu', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);

    fireEvent.click(container.querySelector('.planner-add')!);
    fireEvent.click(screen.getByRole('button', { name: 'Beloning toevoegen' }));

    const sheet = container.querySelector<HTMLElement>('.planner-sheet')!;
    const inputs = sheet.querySelectorAll<HTMLInputElement>('.planner-field input');
    fireEvent.change(inputs[0], { target: { value: 'Naar de film' } });
    fireEvent.change(inputs[1], { target: { value: '40' } });

    // Nothing is preselected from the header; the parent assigns it explicitly.
    const zara = within(sheet)
      .getAllByRole('button')
      .find((button) => button.textContent?.includes('Zara'))!;
    fireEvent.click(zara);
    fireEvent.click(within(sheet).getByRole('button', { name: 'Opslaan' }));

    const pin = container.querySelector<HTMLInputElement>('.planner-pin-input')!;
    expect(pin).not.toBeNull();
    fireEvent.change(pin, { target: { value: '0123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ontgrendelen' }));

    await waitFor(() =>
      expect(mocks.createReward).toHaveBeenCalledWith({
        name: 'Naar de film',
        cost: 40,
        assignedUserNames: ['Zara'],
      }),
    );
  });
});

/**
 * Tapping a card on a shared display must never complete a chore by itself:
 * the child confirms first. Nothing reaches ChoreOps until they say yes, and
 * only a chore nobody owns yet is worded as a claim.
 */
describe('ChorePlanner completion confirmation', () => {
  beforeEach(() => {
    mocks.state.current = choreOpsState();
    mocks.pressButton.mockClear();
    localStorage.clear();
  });

  it('asks before finishing the child’s own chore and does nothing on cancel', () => {
    const { container } = renderPlanner([PARENT, ZARA]);

    fireEvent.click(container.querySelector('.planner-row-check')!);

    // The chore is already Zara's, so this is finishing it, not claiming it.
    expect(container.textContent).toContain('Taakje afronden?');
    expect(container.textContent).not.toContain('Taakje claimen?');
    expect(mocks.pressButton).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Annuleren' }));
    expect(container.textContent).not.toContain('Taakje afronden?');
    expect(mocks.pressButton).not.toHaveBeenCalled();
  });

  it('finishes the chore once the child confirms', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);

    fireEvent.click(container.querySelector('.planner-row-check')!);
    fireEvent.click(screen.getByRole('button', { name: 'Bevestigen' }));

    await waitFor(() =>
      expect(mocks.pressButton).toHaveBeenCalledWith('button.zara_choreops_claim_chore_afwassen'),
    );
    // The toast names what happened — this was finishing, not claiming.
    await waitFor(() =>
      expect(container.querySelector('.planner-toast')?.textContent).toBe('Afgerond · Afwassen'),
    );
  });

  it('lets a parent sign the chore off, behind the PIN — never the child', async () => {
    mocks.pressButton.mockClear();
    mocks.state.current = choreOpsState({
      chores: [
        {
          ...choreOpsState().chores[0],
          status: 'claimed',
          actions: { approve: 'button.zara_approve_afwassen' },
        },
      ],
    });
    const { container } = renderPlanner([PARENT, ZARA]);

    // The child's own tap is not an approval: nothing is sent to ChoreOps.
    fireEvent.click(container.querySelector('.planner-row-check')!);
    expect(mocks.pressButton).not.toHaveBeenCalled();
    expect(container.querySelector('.planner-sheet--confirm')).toBeNull();

    // Signing off lives in the row's actions, and asks for the parent PIN.
    fireEvent.click(container.querySelector('.planner-row-more')!);
    fireEvent.click(screen.getByRole('button', { name: 'Voltooiing goedkeuren' }));

    const pin = container.querySelector<HTMLInputElement>('.planner-pin-input')!;
    fireEvent.change(pin, { target: { value: '0123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ontgrendelen' }));

    await waitFor(() =>
      expect(mocks.pressButton).toHaveBeenCalledWith('button.zara_approve_afwassen'),
    );
  });

  it('only offers to claim a chore nobody owns yet', async () => {
    mocks.state.current = choreOpsState({
      chores: [
        {
          ...choreOpsState().chores[0],
          completionCriteria: 'shared_first',
          assignedUserNames: ['Zara', 'Maya'],
        },
      ],
    });
    const { container } = renderPlanner([PARENT, ZARA]);

    // A free chore asks who is taking it — that picker is the confirmation.
    fireEvent.click(freeColumn(container).querySelector('.planner-row-check')!);
    expect(container.textContent).toContain('Wie pakt dit op?');
    fireEvent.click(
      within(container.querySelector<HTMLElement>('.planner-sheet')!).getByRole('button', {
        name: 'Zara',
      }),
    );

    await waitFor(() =>
      expect(mocks.pressButton).toHaveBeenCalledWith('button.zara_choreops_claim_chore_afwassen'),
    );
    await waitFor(() =>
      expect(container.querySelector('.planner-toast')?.textContent).toBe('Geclaimd · Afwassen'),
    );
  });

  /*
   * Regression: `pendingTaskId` used to be cleared only on the error path, so
   * after one successful claim/approve every later tap was swallowed by
   * `completeTask`'s in-flight guard and the board needed a page reload.
   */
  it('keeps working after one chore is confirmed (no reload needed)', async () => {
    mocks.state.current = choreOpsState({
      chores: [
        { ...choreOpsState().chores[0], id: 'status:zara::afwassen', name: 'Afwassen' },
        {
          ...choreOpsState().chores[0],
          id: 'status:zara::afdrogen',
          name: 'Afdrogen',
          actions: { claim: 'button.zara_choreops_claim_chore_afdrogen' },
        },
      ],
    });
    const { container } = renderPlanner([PARENT, ZARA]);

    for (const [label, entityId] of [
      ['Afwassen', 'button.zara_choreops_claim_chore_afwassen'],
      ['Afdrogen', 'button.zara_choreops_claim_chore_afdrogen'],
    ] as const) {
      const row = [...container.querySelectorAll<HTMLElement>('.planner-row')].find((element) =>
        element.textContent?.includes(label),
      );
      fireEvent.click(row!.querySelector('.planner-row-check')!);
      fireEvent.click(screen.getByRole('button', { name: 'Bevestigen' }));
      await waitFor(() => expect(mocks.pressButton).toHaveBeenCalledWith(entityId));
    }

    expect(mocks.pressButton).toHaveBeenCalledTimes(2);
  });
});

/**
 * The board shows every child as a column of their own chores and routines, plus
 * the chores anyone may take. Rows act in place: nothing opens a separate page.
 */
describe('ChorePlanner board', () => {
  const MAYA = makeMember({ id: 'c2', name: 'Maya', choreops_user: 'Maya' });

  function twoChildren(): ChoreOpsState {
    const base = choreOpsState();
    return {
      ...base,
      users: [
        { ...base.users[0], name: 'Maya', slug: 'maya', points: 10 },
        { ...base.users[0], name: 'Zara', slug: 'zara', points: 25 },
      ],
    };
  }

  beforeEach(() => {
    mocks.state.current = twoChildren();
    mocks.createReward.mockClear();
    mocks.fetchChoreHistory.mockReset();
    mocks.fetchChoreHistory.mockResolvedValue([]);
  });

  it('keeps the live clock at the far right after the header actions', () => {
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);
    const actions = container.querySelector('.planner-header-actions');

    expect(actions?.querySelector('.language-switcher')).not.toBeNull();
    expect(actions?.querySelector('.language-switcher')?.nextElementSibling).toHaveClass(
      'planner-header-clock',
    );
    expect(actions?.lastElementChild).toHaveClass('planner-header-clock');
  });

  it('shows every child and parent plus the free-chore column, without a header rewards button', () => {
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);

    const names = [...container.querySelectorAll('.planner-col-head strong')].map(
      (element) => element.textContent,
    );
    expect(names).toEqual(['Maya', 'Zara', 'Papa', 'Vrij te pakken']);
    // Adding a chore never requires picking a child first.
    expect(container.querySelector('.planner-add')).not.toBeNull();
    // Rewards are per child: they live behind each column's points badge.
    expect(container.querySelector('button[aria-label="Beloningen"]')).toBeNull();
  });

  it('puts each chore in the column of the child it belongs to', () => {
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);

    const zara = column(container, 'Zara');
    expect(zara.querySelectorAll('.planner-row')).toHaveLength(1);
    expect(zara.textContent).toContain('Afwassen');
    expect(column(container, 'Maya').querySelectorAll('.planner-row')).toHaveLength(0);
  });

  it('keeps a recurring ChoreOps task as a chore even when it has a routine label', () => {
    const base = twoChildren();
    mocks.state.current = {
      ...base,
      chores: [
        ...base.chores,
        {
          ...base.chores[0],
          id: 'status:zara::kamer-opruimen',
          name: 'Kamer opruimen',
          assignee: 'Zara',
          frequency: 'daily',
          labels: ['Ochtendroutine'],
          actions: { claim: 'button.zara_choreops_claim_chore_kamer_opruimen' },
        },
      ],
    };
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);

    const zara = column(container, 'Zara');
    expect(zara.textContent).toContain('Kamer opruimen');
    expect(zara.querySelector('.planner-row--routine')).toBeNull();
    expect(zara.querySelectorAll('.planner-row')).toHaveLength(2);
    expect(column(container, 'Maya').querySelector('.planner-row--routine')).toBeNull();
  });

  it('opens the one-off chore form when quick add asks for a chore', () => {
    const { container } = renderPlanner([PARENT, ZARA], { kind: 'chore', token: 1 });

    const form = container.querySelector('.planner-sheet--form')!;
    expect(form).not.toBeNull();
    expect(form.querySelector('select')).toBeNull();
    expect(form.textContent).toContain(
      'Een taakje gebeurt één keer. Gebruik een routine voor iets dat terugkomt.',
    );
  });

  /* A task happens once, so it gets no schedule fields at all and saves as `none`. */
  it('gives a plain task no schedule at all', () => {
    const { container } = renderPlanner([PARENT, ZARA], { kind: 'chore', token: 1 });

    const form = container.querySelector('.planner-sheet--form')!;
    expect(form.querySelector('select')).toBeNull();
    expect(form.textContent).toContain(
      'Een taakje gebeurt één keer. Gebruik een routine voor iets dat terugkomt.',
    );
  });

  it('opens a child’s detail page from their column header', () => {
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);

    fireEvent.click(
      column(container, 'Zara').querySelector<HTMLButtonElement>('.planner-col-open')!,
    );

    const detail = container.querySelector('.planner-detail')!;
    expect(detail).not.toBeNull();
    expect(detail.textContent).toContain('Zara');
    expect(container.querySelector('.planner-title-full')?.textContent).toBe('Zara');

    // Back returns to the board with every family member and free column.
    fireEvent.click(container.querySelector('.planner-header .planner-icon-button')!);
    expect(container.querySelector('.planner-detail')).toBeNull();
    expect(container.querySelectorAll('.planner-col')).toHaveLength(4);
  });

  it('shows completed chore history with the same date ranges', async () => {
    const now = Date.now();
    const base = choreOpsState();
    mocks.state.current = {
      ...base,
      chores: [
        {
          ...base.chores[0],
          statusEntityId: 'sensor.zara_choreops_chore_status_afwassen',
        },
      ],
    };
    mocks.fetchChoreHistory.mockResolvedValue([
      {
        id: 'recent',
        entityId: 'sensor.zara_choreops_chore_status_afwassen',
        choreName: 'Afwassen vandaag',
        completedAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
        completedAtMs: now - 24 * 60 * 60 * 1000,
        points: 3,
      },
      {
        id: 'older',
        entityId: 'sensor.zara_choreops_chore_status_afwassen',
        choreName: 'Afwassen eerder',
        completedAt: new Date(now - 3 * 24 * 60 * 60 * 1000).toISOString(),
        completedAtMs: now - 3 * 24 * 60 * 60 * 1000,
        points: 3,
      },
    ]);
    const { container } = renderPlanner([PARENT, ZARA]);

    fireEvent.click(
      column(container, 'Zara').querySelector<HTMLButtonElement>('.planner-col-open')!,
    );
    await waitFor(() => expect(container.textContent).toContain('Afwassen eerder'));
    expect(mocks.fetchChoreHistory).toHaveBeenCalledWith([
      {
        entityId: 'sensor.zara_choreops_chore_status_afwassen',
        choreName: 'Afwassen',
        points: 3,
      },
    ]);

    const changeHistoryRange = (value: 'twoDays' | 'week') => {
      const history = container.querySelector<HTMLElement>('.planner-detail')!;
      fireEvent.change(within(history).getByLabelText('Periode'), { target: { value } });
    };
    const historyNames = () => {
      const history = container.querySelector<HTMLElement>('.planner-detail');
      const completedSection = [
        ...(history?.querySelectorAll<HTMLElement>('.planner-detail-section') ?? []),
      ].find((section) => section.querySelector('h3')?.textContent?.includes('Voltooide taakjes'));
      return [...(completedSection?.querySelectorAll('.planner-reward-copy strong') ?? [])].map(
        (item) => item.textContent,
      );
    };

    changeHistoryRange('twoDays');
    await waitFor(() => expect(historyNames()).toEqual(['Afwassen vandaag']));

    changeHistoryRange('week');
    await waitFor(() => expect(historyNames()).toEqual(['Afwassen vandaag', 'Afwassen eerder']));
  });

  it('offers only saved rewards when asking where earned points should go', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);

    fireEvent.click(column(container, 'Zara').querySelector('.planner-row-check')!);
    fireEvent.click(screen.getByRole('button', { name: 'Bevestigen' }));

    await waitFor(() =>
      expect(container.textContent).toContain('Waar wil je de punten aan koppelen?'),
    );
    expect(container.textContent).toContain('Schermtijd');
    expect(container.textContent).not.toContain('Spaarpot');
    expect(container.textContent).toContain('Stel een doel in');
  });

  it('hides a parent or child from the board from the filter sheet', () => {
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);
    expect(container.querySelectorAll('.planner-col')).toHaveLength(4);

    fireEvent.click(container.querySelector('button[aria-label="Filteren"]')!);
    const sheet = container.querySelector<HTMLElement>('.planner-sheet')!;
    fireEvent.click(within(sheet).getByRole('button', { name: /Maya/ }));

    expect(container.querySelectorAll('.planner-col')).toHaveLength(3);
  });

  it('opens the shared routine editor from the Chores add sheet', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);

    fireEvent.click(container.querySelector<HTMLButtonElement>('.planner-add')!);
    fireEvent.click(screen.getByRole('button', { name: NL.t('planner.routineNew') }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    fireEvent.click(
      within(screen.getByRole('group', { name: NL.t('planner.forWho') })).getByRole('button', {
        name: ZARA.name,
      }),
    );
    fireEvent.change(screen.getByPlaceholderText(NL.t('settings.family.routineNamePlaceholder')), {
      target: { value: 'Before school' },
    });
    fireEvent.change(
      screen.getByPlaceholderText(NL.t('settings.family.taskPlaceholder', { n: 1 })),
      { target: { value: 'Pack bag' } },
    );
    fireEvent.click(screen.getByText(NL.t('settings.family.saveRoutine')));

    await waitFor(() => {
      expect(JSON.parse(localStorage.getItem('abbai_flow_routines') ?? '[]')).toEqual([
        expect.objectContaining({ name: 'Before school', member_id: ZARA.id }),
      ]);
    });
  });

  /*
   * The phone layout rendered no entry point at all: no detail page, no way to
   * start missions. Both now sit right under the member tabs.
   */
  it('opens a child’s detail page and starts missions from the phone layout', () => {
    const original = window.matchMedia;
    // jsdom has no matchMedia; the board asks for the phone layout explicitly.
    window.matchMedia = ((query: string) => ({
      matches: query.includes('max-width'),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;

    try {
      const { container } = renderPlanner([PARENT, ZARA, MAYA]);
      // Pick Zara explicitly: the phone layout starts on the first member.
      fireEvent.click(within(container).getByRole('button', { name: 'Zara' }));

      const actions = container.querySelector<HTMLElement>('.planner-mobile-actions')!;
      expect(actions).not.toBeNull();
      fireEvent.click(within(actions).getByRole('button', { name: /Details bekijken/ }));

      expect(container.querySelector('.planner-detail')).not.toBeNull();
      expect(container.querySelector('.planner-detail')!.textContent).toContain('Zara');
    } finally {
      window.matchMedia = original;
    }
  });

  it('opens one child’s goals from their points badge', () => {
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);
    openRewards(container, 'Zara');

    const sheet = container.querySelector<HTMLElement>('.planner-sheet')!;
    expect(sheet.textContent).toContain('Doelen');
    expect(sheet.textContent).toContain('Schermtijd');
    // Nothing set aside yet: the row reports progress, not the balance.
    expect(sheet.textContent).toContain('0 / 20');
  });

  it('pre-selects the child whose goals you opened when you set a new goal', () => {
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);
    openRewards(container, 'Maya');
    fireEvent.click(
      within(container.querySelector<HTMLElement>('.planner-sheet')!).getByRole('button', {
        name: /Stel een doel in/,
      }),
    );

    const selected = container.querySelectorAll('.planner-member-picker button.is-selected');
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toContain('Maya');
  });
});
