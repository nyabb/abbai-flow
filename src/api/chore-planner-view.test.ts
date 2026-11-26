import { describe, expect, it } from 'vitest';
import { buildChorePlannerView, choresManTaskStatus } from './chore-planner-view';
import type { ChoresManChore, ChoresManState, ChoresManUser } from '../types/choresman';
import type { FamilyMember } from '../types/family';

const family: FamilyMember[] = [
  {
    id: 'member-maya',
    name: 'Maya',
    avatar: '👧',
    photo: '/api/image/serve/abc/512x512',
    color: '#cf6d55',
    role: 'child',
  },
];

function user(name: string, points = 0): ChoresManUser {
  return {
    name,
    slug: name.toLowerCase(),
    points,
    dueToday: 0,
    claimed: 0,
    approved: 0,
    completedToday: 0,
  };
}

function chore(
  name: string,
  status = 'pending',
  overrides: Partial<ChoresManChore> = {},
): ChoresManChore {
  const assignee = overrides.assignee ?? 'Maya';
  return {
    id: `chore:${name.toLowerCase()}:${assignee.toLowerCase()}`,
    sourceId: `source:${name.toLowerCase()}`,
    plannerRowId: `row:${name.toLowerCase()}:${assignee.toLowerCase()}`,
    name,
    icon: null,
    status,
    assignee,
    points: 0,
    canClaim: true,
    canApprove: false,
    actions: { claim: `choresman-action:claim:${name.toLowerCase()}` },
    ...overrides,
  };
}

function state(
  chores: ChoresManChore[],
  users: ChoresManUser[] = [user('Maya')],
  rewards: ChoresManState['rewards'] = [],
): ChoresManState {
  return {
    users,
    chores,
    rewards,
    pointsByUser: Object.fromEntries(users.map((item) => [item.name.toLowerCase(), item.points])),
    pendingApprovals: { chores: 0, rewards: 0 },
    available: true,
  };
}

describe('buildChorePlannerView', () => {
  const choresMan = state(
    [
      chore('Afwassen', 'claimed', {
        assignee: 'Maya',
        points: 4,
        icon: 'mdi:silverware',
        actions: { approve: 'choresman-action:approve:afwassen' },
      }),
    ],
    [user('Maya', 12)],
    [
      {
        id: 'reward:film:maya',
        name: 'Filmavond',
        status: 'available',
        cost: 40,
        pendingClaims: 0,
        assignee: 'Maya',
        actions: {},
      },
    ],
  );

  it('renders ChoresMan users with Abbai Flow family photo, colour, and display name', () => {
    const view = buildChorePlannerView(choresMan, family);

    expect(view.available).toBe(true);
    expect(view.members[0]).toMatchObject({
      id: 'member-maya',
      name: 'Maya',
      avatar: '👧',
      photo: '/api/image/serve/abc/512x512',
      color: '#cf6d55',
      savings: 12,
    });
  });

  it('keeps the chore row and action id on the task', () => {
    const view = buildChorePlannerView(choresMan, family);
    const task = view.tasks.find((item) => item.name === 'Afwassen');

    expect(task).toBeDefined();
    expect(task?.memberId).toBe('member-maya');
    expect(task?.points).toBe(4);
    expect(task?.statusOverride).toBe('active');
    expect(task?.awaitingReview).toBe(true);
    expect(task?.actions?.approve).toBe('choresman-action:approve:afwassen');
  });

  it('maps ChoresMan rewards to planner goals', () => {
    const view = buildChorePlannerView(choresMan, family);

    expect(view.goals[0]).toMatchObject({
      title: 'Filmavond',
      target: 40,
      memberIds: ['member-maya'],
    });
  });

  it('does not turn labelled chores into Abbai Flow routines', () => {
    const labelled = state([
      chore('Afwassen', 'pending', { frequency: 'daily', labels: ['Ochtendroutine'] }),
    ]);
    const task = buildChorePlannerView(labelled, family).tasks[0];

    expect(task.routineId).toBeUndefined();
    expect(task.routineName).toBeUndefined();
    expect(task.inRoutine).toBeUndefined();
  });

  it('reports unavailable when ChoresMan has no members or chores', () => {
    expect(buildChorePlannerView({ ...state([]), users: [], available: false }, family)).toMatchObject({
      available: false,
      members: [],
      tasks: [],
      goals: [],
    });
  });
});

describe('choresManTaskStatus', () => {
  it('maps ChoresMan statuses onto planner statuses', () => {
    expect(choresManTaskStatus('approved')).toBe('completed');
    expect(choresManTaskStatus('completed')).toBe('completed');
    expect(choresManTaskStatus('completed_by_other')).toBe('active');
    expect(choresManTaskStatus('in_progress')).toBe('active');
    expect(choresManTaskStatus('overdue')).toBe('late');
    expect(choresManTaskStatus('missed')).toBe('late');
    expect(choresManTaskStatus('due')).toBe('active');
    expect(choresManTaskStatus('claimed')).toBe('active');
  });
});

describe('shared chores', () => {
  const users = [user('Maya'), user('Nova')];
  const shared = (name: string, status: string) =>
    chore('Tafel dekken', status, {
      id: `chore:tafel-dekken:${name.toLowerCase()}`,
      assignee: name,
      assignedUserNames: ['Maya', 'Nova'],
      completionCriteria: 'shared_first',
      actions: status === 'claimed'
        ? { approve: 'choresman-action:approve:table' }
        : status === 'in_progress'
          ? { claim: 'choresman-action:complete:table' }
          : { take: 'choresman-action:take:table' },
    });

  it('labels a first-come chore as anyone while it is open', () => {
    const view = buildChorePlannerView(state([shared('Maya', 'pending'), shared('Nova', 'pending')], users), []);
    expect(view.tasks).toHaveLength(2);
    expect(view.tasks.every((task) => task.audience === 'anyone')).toBe(true);
  });

  it('labels a chore assigned to the whole household as everyone', () => {
    const householdChore = (name: string) =>
      chore('Vacuum', 'pending', {
        assignee: name,
        assignedUserNames: ['Maya', 'Nova'],
        completionCriteria: 'shared_all',
      });
    const view = buildChorePlannerView(
      state([householdChore('Maya'), householdChore('Nova')], users),
      [],
    );
    expect(view.tasks.every((task) => task.audience === 'everyone')).toBe(true);
  });

  it('keeps a taken chore active and drops it from the other child’s board', () => {
    const view = buildChorePlannerView(
      state([shared('Maya', 'in_progress'), shared('Nova', 'completed_by_other')], users),
      [],
    );
    expect(view.tasks.map((task) => task.name)).toEqual(['Tafel dekken']);
    expect(view.tasks[0].awaitingReview).toBe(false);
    expect(view.tasks[0].statusOverride).toBe('active');
    expect(view.tasks[0].memberId).toBe('choresman:maya');
    expect(view.tasks[0].audience).toBe('member');
    expect(view.tasks[0].actions?.claim).toBe('choresman-action:complete:table');
  });
});

describe('daily chores', () => {
  const daily = (name: string, status: string, lastCompleted?: string, frequency = 'daily') =>
    chore(name, status, { frequency, lastCompleted });
  const now = new Date('2026-11-06T09:00:00');

  it('keeps daily chores separate from Abbai Flow routines', () => {
    const view = buildChorePlannerView(
      state([
        daily('Tanden poetsen', 'pending'),
        daily('Aankleden', 'pending'),
        daily('Taken uitzoeken', 'pending', undefined, 'weekly'),
      ]),
      [],
      now,
    );
    expect(view.tasks).toHaveLength(3);
    expect(view.tasks.every((task) => !task.routineId && !task.inRoutine)).toBe(true);
  });

  it('drops a daily chore completed on an earlier day but keeps today’s completion', () => {
    const view = buildChorePlannerView(
      state([
        daily('Gisteren', 'approved', '2026-11-05T07:30:00'),
        daily('Vandaag', 'approved', '2026-11-06T07:30:00'),
      ]),
      [],
      now,
    );
    expect(view.tasks.map((task) => task.name)).toEqual(['Vandaag']);
    expect(view.tasks[0].statusOverride).toBe('completed');
  });

  it('keeps old completions for chores that do not repeat daily', () => {
    const view = buildChorePlannerView(
      state([daily('Garage opruimen', 'approved', '2026-10-01T07:30:00', 'none')]),
      [],
      now,
    );
    expect(view.tasks).toHaveLength(1);
  });
});

describe('points and approval edge cases', () => {
  const choreState = (status = 'pending') =>
    state([
      chore('Planten water geven', status, {
        points: 0,
        autoApprove: false,
        actions: status === 'claimed' ? { approve: 'choresman-action:approve:plants' } : {},
      }),
    ], [user('Maya', 12)]);

  it('keeps zero-point chores and claimed work awaiting approval', () => {
    const active = buildChorePlannerView(choreState(), family).tasks[0];
    expect(active.points).toBe(0);
    expect(active.statusOverride).toBe('active');

    const claimed = buildChorePlannerView(choreState('claimed'), family).tasks[0];
    expect(claimed.awaitingReview).toBe(true);
    expect(claimed.statusOverride).not.toBe('completed');
  });

  it('leaves rejected completions active', () => {
    for (const rejected of ['pending', 'overdue', 'missed', 'disapproved']) {
      const task = buildChorePlannerView(choreState(rejected), family).tasks[0];
      expect(task.statusOverride).not.toBe('completed');
      expect(task.awaitingReview).toBe(false);
    }
  });
});
