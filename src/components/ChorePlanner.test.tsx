import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { ChorePlanner } from './ChorePlanner';
import { I18nContext, createI18n } from '../i18n';
import type { FamilyMember } from '../types/family';
import type { ChoreOpsState } from '../types/choreops';

const mocks = vi.hoisted(() => ({
  createReward: vi.fn(async () => {}),
  deleteChore: vi.fn(async () => {}),
  approveReward: vi.fn(async () => {}),
  pressButton: vi.fn(async () => {}),
  state: { current: null as ChoreOpsState | null },
}));

vi.mock('../hooks/useChoreOps', () => ({
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

function renderPlanner(members: FamilyMember[]) {
  return render(
    <I18nContext.Provider value={NL}>
      <ChorePlanner
        members={members}
        weather={null}
        nextAppointment={null}
        locale="nl"
        onLocaleChange={() => {}}
      />
    </I18nContext.Provider>,
  );
}

/** Open the actions sheet of the first chore card. */
function openFirstTaskActions(container: HTMLElement): boolean {
  const more = container.querySelector<HTMLButtonElement>('.planner-task-more');
  if (!more) return false;
  fireEvent.click(more);
  return Boolean(container.querySelector('.planner-destination.planner-danger'));
}

function openRewards(container: HTMLElement) {
  fireEvent.click(container.querySelector('button[aria-label="Beloningen"]')!);
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

    const cards = container.querySelectorAll('.planner-task');
    expect(cards).toHaveLength(2);
    expect(container.querySelectorAll('.planner-task--anyone')).toHaveLength(2);
    expect(container.textContent).toContain('Wie het eerst is');
    expect(screen.getAllByRole('button', { name: 'Pakken' })).toHaveLength(2);
    expect(container.querySelector('.planner-check-hand')).not.toBeNull();
  });

  it('looks like an ordinary assignment once a child claimed it', () => {
    mocks.state.current = anyoneState('claimed', 'completed_by_other');
    const { container } = renderPlanner([PARENT, ZARA, MAYA]);

    // The other child's card is gone; only Zara's remains.
    const cards = container.querySelectorAll('.planner-task');
    expect(cards).toHaveLength(1);
    expect(container.querySelector('.planner-task--anyone')).toBeNull();
    expect(container.textContent).not.toContain('Wie het eerst is');
    expect(cards[0].querySelector('.planner-member-chip')?.textContent).toContain('Zara');
    expect(container.querySelector('.planner-check-hand')).toBeNull();
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
   * Points must leave the child's balance the moment they pick a reward, not
   * when a parent confirms it. The allocation is Beacon-local so the child can
   * take it back; approving later only writes the (single) deduction to
   * ChoreOps and must not move the visible balance again.
   */
  it('sets points aside on assign and frees them on undo', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    fireEvent.click(screen.getByRole('button', { name: 'Toewijzen' }));

    await waitFor(() =>
      expect(container.textContent).toContain('Toegewezen · wacht op bevestiging'),
    );
    expect(localStorage.getItem('beacon_reward_reservations')).toContain('schermtijd');

    fireEvent.click(screen.getByRole('button', { name: 'Terug' }));

    await waitFor(() => expect(container.textContent).toContain('20 punten'));
    expect(localStorage.getItem('beacon_reward_reservations')).toBeNull();
    expect(mocks.approveReward).not.toHaveBeenCalled();
  });

  it('confirms a reserved reward through ChoreOps once, without a second deduction', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    fireEvent.click(screen.getByRole('button', { name: 'Toewijzen' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Bevestigen' }));

    const pin = container.querySelector<HTMLInputElement>('.planner-pin-input')!;
    fireEvent.change(pin, { target: { value: '0123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ontgrendelen' }));

    await waitFor(() => expect(mocks.approveReward).toHaveBeenCalledTimes(1));
    // The PIN identifies the approving parent for ChoreOps' audit trail.
    expect(mocks.approveReward).toHaveBeenCalledWith('Zara', 'Schermtijd', 'Papa');
    // ChoreOps now owns the deduction, so Beacon releases its hold.
    await waitFor(() => expect(localStorage.getItem('beacon_reward_reservations')).toBeNull());
  });

  it('creates a per-child reward in ChoreOps', async () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    openRewards(container);

    fireEvent.click(screen.getByRole('button', { name: /Beloning toevoegen/ }));

    const nameInput = container.querySelectorAll<HTMLInputElement>('.planner-field input')[0];
    const costInput = container.querySelectorAll<HTMLInputElement>('.planner-field input')[1];
    fireEvent.change(nameInput, { target: { value: 'Naar de film' } });
    fireEvent.change(costInput, { target: { value: '40' } });

    // Pick Zara inside the reward form's member picker.
    const picker = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.planner-member-picker button'),
    ).find((button) => button.textContent?.includes('Zara'))!;
    fireEvent.click(picker);
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

    fireEvent.click(container.querySelector('.planner-check')!);

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

    fireEvent.click(container.querySelector('.planner-check')!);
    fireEvent.click(screen.getByRole('button', { name: 'Bevestigen' }));

    await waitFor(() =>
      expect(mocks.pressButton).toHaveBeenCalledWith('button.zara_claim_afwassen'),
    );
    // The toast names what happened — this was finishing, not claiming.
    await waitFor(() =>
      expect(container.querySelector('.planner-toast')?.textContent).toBe('Afgerond · Afwassen'),
    );
  });

  it('asks a different question when a parent signs the chore off', async () => {
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

    fireEvent.click(container.querySelector('.planner-check')!);

    expect(container.textContent).toContain('Taakje afronden?');
    fireEvent.click(screen.getByRole('button', { name: 'Bevestigen' }));

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

    fireEvent.click(container.querySelector('.planner-check')!);

    expect(container.textContent).toContain('Taakje claimen?');
    fireEvent.click(screen.getByRole('button', { name: 'Bevestigen' }));

    await waitFor(() =>
      expect(mocks.pressButton).toHaveBeenCalledWith('button.zara_claim_afwassen'),
    );
    await waitFor(() =>
      expect(container.querySelector('.planner-toast')?.textContent).toBe('Geclaimd · Afwassen'),
    );
  });

  /*
   * The bottom-tab badge counts what is still on the child's plate. A claimed
   * chore is done as far as the child is concerned (a parent's approval is a
   * real-life confirmation), so it must not keep the badge alive.
   */
  it('drops the badge once every chore is claimed or finished', () => {
    mocks.state.current = choreOpsState();
    const open = renderPlanner([PARENT, ZARA]);
    expect(open.container.querySelector('.planner-nav-badge')?.textContent).toBe('1');
    open.unmount();

    for (const status of ['claimed', 'completed']) {
      mocks.state.current = choreOpsState({
        chores: [{ ...choreOpsState().chores[0], status }],
      });
      const done = renderPlanner([PARENT, ZARA]);
      expect(done.container.querySelector('.planner-nav-badge')).toBeNull();
      done.unmount();
    }
  });
});
