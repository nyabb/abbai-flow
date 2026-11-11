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
        name: 'Afwassen',
        icon: 'mdi:silverware',
        status: 'pending',
        assignee: 'Zara',
        points: 3,
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
      id: `status:${name.toLowerCase()}::tafeldekken`,
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
      actions: { claim: `button.${name.toLowerCase()}_claim_tafeldekken` },
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

describe('ChorePlanner rewards from ChoreOps', () => {
  beforeEach(() => {
    mocks.state.current = choreOpsState();
    mocks.createReward.mockClear();
    mocks.approveReward.mockClear();
    localStorage.clear();
  });

  it('lists the rewards ChoreOps publishes with their cost', () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    expect(container.textContent).toContain('Schermtijd');
    expect(container.textContent).toContain('20 punten');
    // Zara saved 25, so the reward is affordable.
    const assign = screen.getByRole('button', { name: 'Toewijzen' }) as HTMLButtonElement;
    expect(assign.disabled).toBe(false);
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

    fireEvent.click(screen.getByRole('button', { name: 'Toewijzen' }));

    await waitFor(() => expect(container.textContent).toContain('Wacht op beloning'));
    expect(container.textContent).toContain('20 / 20');
    await waitFor(() =>
      expect(localStorage.getItem('beacon-reward-redemptions')).toContain('schermtijd'),
    );
    // A reached goal is not a given reward: no ChoreOps deduction happened.
    expect(mocks.approveReward).not.toHaveBeenCalled();
  });

  /* Allocation never needs a parent: no PIN sheet and no ChoreOps write. */
  it('never asks a parent to approve an allocation', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    fireEvent.click(screen.getByRole('button', { name: 'Toewijzen' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'Toewijzen' }));

    // Zara has 25 and the goal wants 40, so all 25 go towards it and it stays open.
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

    fireEvent.click(screen.getByRole('button', { name: 'Toewijzen' }));
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

    fireEvent.click(screen.getByRole('button', { name: /Stel een doel in/ }));

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
      expect(mocks.pressButton).toHaveBeenCalledWith('button.zara_claim_afwassen'),
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
      expect(mocks.pressButton).toHaveBeenCalledWith('button.zara_claim_afwassen'),
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
          actions: { claim: 'button.zara_claim_afdrogen' },
        },
      ],
    });
    const { container } = renderPlanner([PARENT, ZARA]);

    for (const [label, entityId] of [
      ['Afwassen', 'button.zara_claim_afwassen'],
      ['Afdrogen', 'button.zara_claim_afdrogen'],
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
  });

  it('shows a column per child plus the free-chore column, and no header rewards button', () => {
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);

    const names = [...container.querySelectorAll('.planner-col-head strong')].map(
      (element) => element.textContent,
    );
    expect(names).toEqual(['Maya', 'Zara', 'Vrij te pakken']);
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

  it('shows a child’s routines under their chores', () => {
    // ChoreOps groups daily chores into routines by their label.
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
          actions: { claim: 'button.zara_claim_kamer_opruimen' },
        },
      ],
    };
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);

    const zara = column(container, 'Zara');
    expect(zara.textContent).toContain('Ochtendroutine');
    expect(zara.querySelector('.planner-row--routine')).not.toBeNull();
    expect(column(container, 'Maya').querySelector('.planner-row--routine')).toBeNull();
  });

  it('opens the new-chore form when quick add asks for one', () => {
    const { container } = renderPlanner([PARENT, ZARA], { kind: 'routine', token: 1 });

    const form = container.querySelector('.planner-sheet--form')!;
    expect(form).not.toBeNull();
    // A routine starts as a daily chore.
    expect((form.querySelector('select') as HTMLSelectElement | null)?.value).toBe('daily');
  });

  /*
   * A routine *is* a recurring chore carrying a routine label: ChoreOps only
   * groups daily chores into routines. Recurrence therefore lives here, and a
   * new routine starts on daily while staying changeable (weekly adds the
   * weekday pills) -- pinning it would make weekly routines impossible.
   */
  it('starts a new routine on daily and leaves the repeat changeable', () => {
    const { container } = renderPlanner([PARENT, ZARA], { kind: 'routine', token: 1 });

    const form = container.querySelector('.planner-sheet--form')!;
    const select = form.querySelector('select') as HTMLSelectElement;
    expect(select.value).toBe('daily');
    expect(select.disabled).toBe(false);
    expect(form.textContent).toContain('Routine');
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

    // Back returns to the board with every column again (two children + free).
    fireEvent.click(container.querySelector('.planner-header .planner-icon-button')!);
    expect(container.querySelector('.planner-detail')).toBeNull();
    expect(container.querySelectorAll('.planner-col')).toHaveLength(3);
  });

  /*
   * The award sheet asks where the earned points should go once a chore is ticked off, so
   * the child can push them towards a savings goal instead of a blind balance.
   */
  it('asks where the points go after a chore is confirmed', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);

    fireEvent.click(column(container, 'Zara').querySelector('.planner-row-check')!);
    fireEvent.click(screen.getByRole('button', { name: 'Bevestigen' }));

    await waitFor(() =>
      expect(container.textContent).toContain('Waar wil je de punten aan koppelen?'),
    );
    expect(container.textContent).toContain('Spaarpot');
    expect(container.textContent).toContain('Schermtijd');
    expect(container.textContent).toContain('Stel een doel in');
  });

  it('hides a member from the board from the filter sheet', () => {
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);
    expect(container.querySelectorAll('.planner-col')).toHaveLength(3);

    fireEvent.click(container.querySelector('button[aria-label="Filteren"]')!);
    const sheet = container.querySelector<HTMLElement>('.planner-sheet')!;
    fireEvent.click(within(sheet).getByRole('button', { name: /Maya/ }));

    expect(container.querySelectorAll('.planner-col')).toHaveLength(2);
  });

  it('pauses and resumes a routine', async () => {
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
        },
      ],
    };
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);

    const pause = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="Pauzeren: Ochtendroutine"]',
    )!;
    fireEvent.click(pause);

    // Pause is a shared planner operation (server-side in add-on mode), so the
    // row updates once it has been applied.
    await waitFor(() => {
      const row = container.querySelector('.planner-row--routine')!;
      expect(row.className).toContain('is-paused');
    });
    expect(
      container.querySelector('button[aria-label^="Hervatten: Ochtendroutine"]'),
    ).not.toBeNull();
  });

  /*
   * A child whose whole day is routines has no standalone chores, so the old
   * `disabled={chores.length === 0}` left the mission button dead — and the
   * routines themselves were only a name and a bar, with no steps.
   */
  it('lists a routine’s steps and lets a routine-only child start missions', () => {
    const base = twoChildren();
    mocks.state.current = {
      ...base,
      chores: [
        {
          ...base.chores[0],
          id: 'status:zara::kamer-opruimen',
          name: 'Kamer opruimen',
          assignee: 'Zara',
          frequency: 'daily',
          labels: ['Ochtendroutine'],
        },
      ],
    };
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);

    const zara = column(container, 'Zara');
    const row = zara.querySelector<HTMLElement>('.planner-row--routine')!;
    expect(row.querySelector('.planner-steps')?.textContent).toContain('Kamer opruimen');
    expect(row.querySelector('.planner-routine-count')?.textContent).toBe('0/1');

    // Nothing loose to do, but there is a routine to run.
    expect(zara.querySelector<HTMLButtonElement>('.planner-col-play')!.disabled).toBe(false);
  });

  it('marks routine steps that are already done today', () => {
    const base = twoChildren();
    mocks.state.current = {
      ...base,
      chores: [
        {
          ...base.chores[0],
          id: 'status:zara::kamer-opruimen',
          name: 'Kamer opruimen',
          assignee: 'Zara',
          frequency: 'daily',
          status: 'completed',
          labels: ['Ochtendroutine'],
        },
      ],
    };
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);

    const row = column(container, 'Zara').querySelector<HTMLElement>('.planner-row--routine')!;
    expect(row.querySelector('.planner-routine-count')?.textContent).toBe('1/1');
    expect(row.querySelector('.planner-step')?.className).toContain('is-done');
    // Nothing left to run, so starting a mission is pointless.
    expect(
      column(container, 'Zara').querySelector<HTMLButtonElement>('.planner-col-play')!.disabled,
    ).toBe(true);
  });

  it('starts just one routine from its row', () => {
    const base = twoChildren();
    mocks.state.current = {
      ...base,
      chores: [
        {
          ...base.chores[0],
          id: 'status:zara::kamer-opruimen',
          name: 'Kamer opruimen',
          assignee: 'Zara',
          frequency: 'daily',
          labels: ['Ochtendroutine'],
        },
      ],
    };
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);

    fireEvent.click(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label^="Deze routine starten: Ochtendroutine"]',
      )!,
    );

    // The mission screen walks the routine's remaining steps.
    expect(container.querySelector('.planner-mission-screen')).not.toBeNull();
    expect(container.textContent).toContain('Kamer opruimen');
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
      fireEvent.click(within(actions).getByRole('button', { name: /Openen/ }));

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
