import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { ChorePlanner } from '../ChorePlanner';
import { I18nContext, createI18n } from '../../i18n';
import type { FamilyMember } from '../../types/family';
import type { ChoreOpsState } from '../../types/choreops';
import { PLANNER_META_KEY } from '../../api/planner-meta';

const mocks = vi.hoisted(() => ({
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
    createReward: async () => {},
    deleteReward: async () => {},
    deleteChore: async () => {},
    approveReward: async () => {},
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

/**
 * One child with a two-step morning routine and one standalone chore.
 * `labels` is how the household already names routines in ChoreOps; Abbai Flow
 * adopts it into its own registry.
 */
function routineState(): ChoreOpsState {
  return {
    users: [
      {
        name: 'Zara',
        slug: 'zara',
        points: 25,
        dueToday: 3,
        claimed: 0,
        approved: 0,
        completedToday: 0,
      },
    ],
    chores: [
      {
        id: 'status:zara::tanden-poetsen',
        name: 'Tanden poetsen',
        icon: 'mdi:tooth',
        status: 'pending',
        assignee: 'Zara',
        points: 5,
        dueDate: null,
        canClaim: true,
        canApprove: false,
        frequency: 'daily',
        labels: ['Ochtendroutine'],
        actions: { claim: 'button.zara_claim_tanden' },
      },
      {
        id: 'status:zara::aankleden',
        name: 'Aankleden',
        icon: 'mdi:tshirt',
        status: 'pending',
        assignee: 'Zara',
        points: 5,
        dueDate: null,
        canClaim: true,
        canApprove: false,
        frequency: 'daily',
        labels: ['Ochtendroutine'],
        actions: { claim: 'button.zara_claim_aankleden' },
      },
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
    rewards: [],
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

function column(container: HTMLElement, name: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('.planner-col')].find((element) =>
    element.querySelector('.planner-col-head strong')?.textContent?.includes(name),
  );
  return found!;
}

/** Seed the shared metadata document the planner hydrates from. */
function seedMeta(meta: unknown) {
  localStorage.setItem(PLANNER_META_KEY, JSON.stringify(meta));
}

describe('ChorePlanner routines', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.pressButton.mockClear();
    mocks.state.current = routineState();
  });

  it('keeps routine steps out of the individual chore list', () => {
    const { container } = renderPlanner([PARENT, ZARA]);
    const zara = column(container, 'Zara');
    const names = [...zara.querySelectorAll('.planner-row-name')].map((node) => node.textContent);

    // The standalone chore is listed; the two routine steps are not.
    expect(names).toContain('Afwassen');
    expect(names).not.toContain('Tanden poetsen');
    expect(names).not.toContain('Aankleden');
    // ...and the routine itself is shown, so nothing is hidden from the child.
    expect(zara.textContent).toContain('Ochtendroutine');
  });

  it('adopts an existing ChoreOps label as one routine with an ordered task list', async () => {
    renderPlanner([PARENT, ZARA]);

    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(PLANNER_META_KEY) ?? '{}');
      const routine = stored.routines?.find(
        (item: { name: string }) => item.name === 'Ochtendroutine',
      );
      expect(routine).toBeTruthy();
      expect(routine.taskNames).toEqual(['Tanden poetsen', 'Aankleden']);
    });
  });

  it('runs the routine in the order the registry defines', async () => {
    seedMeta({
      version: 1,
      routines: [
        {
          id: 'ochtendroutine',
          name: 'Ochtendroutine',
          icon: '\u23F0',
          taskNames: ['Aankleden', 'Tanden poetsen'],
        },
      ],
      missions: {},
    });
    const { container } = renderPlanner([PARENT, ZARA]);

    fireEvent.click(
      column(container, 'Zara').querySelector<HTMLButtonElement>('.planner-col-play')!,
    );
    await waitFor(() =>
      expect(container.querySelector('.planner-mission-hero h2')?.textContent).toBe('Aankleden'),
    );
    expect(container.querySelector('.planner-mission-progress')?.textContent).toContain('1');

    // Finishing a step asks "are you sure?" first, then advances to the next.
    fireEvent.click(container.querySelector<HTMLButtonElement>('.planner-mission-done')!);
    fireEvent.click(
      container.querySelector<HTMLButtonElement>('.planner-sheet--confirm .planner-primary')!,
    );
    await waitFor(() =>
      expect(container.querySelector('.planner-mission-hero h2')?.textContent).toBe(
        'Tanden poetsen',
      ),
    );
    expect(mocks.pressButton).toHaveBeenCalledWith('button.zara_claim_aankleden');
  });

  it('leaves a paused routine out of the mission run', async () => {
    seedMeta({
      version: 1,
      routines: [
        {
          id: 'ochtendroutine',
          name: 'Ochtendroutine',
          icon: '\u23F0',
          taskNames: ['Tanden poetsen', 'Aankleden'],
          paused: true,
        },
      ],
      missions: {},
    });
    const { container } = renderPlanner([PARENT, ZARA]);

    // The only routine is paused, so there is nothing to run: the button says so
    // instead of starting a mission that immediately ends.
    const play = column(container, 'Zara').querySelector<HTMLButtonElement>('.planner-col-play')!;
    expect(play.disabled).toBe(true);

    fireEvent.click(play);
    expect(container.querySelector('.planner-mission-hero')).toBeNull();
  });
});
