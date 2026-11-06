import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { ChorePlanner } from './ChorePlanner';
import type { FamilyMember } from '../types/family';
import type { ChoreOpsState } from '../types/choreops';

const mocks = vi.hoisted(() => ({
  createReward: vi.fn(async () => {}),
  deleteChore: vi.fn(async () => {}),
  approveReward: vi.fn(async () => {}),
  state: { current: null as ChoreOpsState | null },
}));

vi.mock('../hooks/useChoreOps', () => ({
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

function renderPlanner(members: FamilyMember[]) {
  return render(<ChorePlanner members={members} weather={null} nextAppointment={null} />);
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
