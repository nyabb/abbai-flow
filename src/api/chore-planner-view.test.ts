import { describe, expect, it } from 'vitest';
import { buildChorePlannerView, choreOpsTaskStatus } from './chore-planner-view';
import { normalizeChoreOps } from './choreops';
import type { FamilyMember } from '../types/family';

const family: FamilyMember[] = [
  {
    id: 'member-maya',
    name: 'Maya',
    avatar: '👧',
    photo: '/api/image/serve/abc/512x512',
    color: '#cf6d55',
    role: 'child',
    choreops_user: 'Maya',
  },
];

const states = normalizeChoreOps([
  {
    entity_id: 'sensor.maya_choreops_points',
    state: '12',
    attributes: { purpose: 'purpose_points', user_name: 'Maya' },
  },
  {
    entity_id: 'sensor.system_choreops_afwassen_global_status',
    state: 'claimed',
    attributes: {
      purpose: 'purpose_shared_chore',
      chore_name: 'Afwassen',
      assigned_user_names: ['Maya'],
      default_points: 4,
      icon: 'mdi:silverware',
    },
  },
  {
    entity_id: 'button.maya_choreops_approve_chore_afwassen',
    state: 'unknown',
    attributes: {
      purpose: 'purpose_button_chore_approve',
      user_name: 'Maya',
      chore_name: 'Afwassen',
    },
  },
  {
    entity_id: 'sensor.maya_choreops_reward_status_film',
    state: 'available',
    attributes: {
      purpose: 'purpose_reward_status',
      reward_name: 'Filmavond',
      cost: 40,
      user_name: 'Maya',
    },
  },
]);

describe('buildChorePlannerView', () => {
  it('renders ChoreOps users with Beacon family photo, colour, and display name', () => {
    const view = buildChorePlannerView(states, family);

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

  it('keeps ChoreOps status and action entity ids on the task', () => {
    const view = buildChorePlannerView(states, family);
    const task = view.tasks.find((item) => item.name === 'Afwassen');

    expect(task).toBeDefined();
    expect(task?.memberId).toBe('member-maya');
    expect(task?.points).toBe(4);
    expect(task?.statusOverride).toBe('active');
    expect(task?.awaitingReview).toBe(true);
    expect(task?.actions?.approve).toBe('button.maya_choreops_approve_chore_afwassen');
  });

  it('maps ChoreOps rewards to planner goals', () => {
    const view = buildChorePlannerView(states, family);

    expect(view.goals[0]).toMatchObject({
      title: 'Filmavond',
      target: 40,
      memberIds: ['member-maya'],
    });
  });

  /*
   * A labelled daily chore belongs to a routine, and the task carries that so
   * the mission run can name the routine it is working through -- and so pausing
   * the routine can keep its chores out of the queue.
   */
  it('marks a labelled daily chore with its routine', () => {
    const labelled = {
      ...states,
      chores: [{ ...states!.chores[0], frequency: 'daily', labels: ['Ochtendroutine'] }],
    } as typeof states;

    const task = buildChorePlannerView(labelled, family).tasks[0];

    expect(task.routineId).toBe('routine:ochtendroutine');
    expect(task.routineName).toBe('Ochtendroutine');
  });

  /* A weekly chore keeps its label but is not part of a routine. */
  it('leaves a non-daily chore out of any routine', () => {
    const weekly = {
      ...states,
      chores: [{ ...states!.chores[0], frequency: 'weekly', labels: ['Ochtendroutine'] }],
    } as typeof states;

    const task = buildChorePlannerView(weekly, family).tasks[0];

    expect(task.routineId).toBeUndefined();
  });

  it('reports unavailable when ChoreOps published nothing', () => {
    expect(buildChorePlannerView(null, family)).toMatchObject({
      available: false,
      members: [],
      tasks: [],
      goals: [],
    });
  });
});

describe('choreOpsTaskStatus', () => {
  it('maps ChoreOps statuses onto planner statuses', () => {
    expect(choreOpsTaskStatus('approved')).toBe('completed');
    expect(choreOpsTaskStatus('completed')).toBe('completed');
    expect(choreOpsTaskStatus('overdue')).toBe('late');
    expect(choreOpsTaskStatus('missed')).toBe('late');
    expect(choreOpsTaskStatus('due')).toBe('active');
    expect(choreOpsTaskStatus('claimed')).toBe('active');
  });
});

/**
 * "Anyone" chores (ChoreOps `shared_first`) are one chore several children can
 * take. The first child to claim it keeps it — ChoreOps locks the others out
 * with `completed_by_other` — so Beacon must show the "anyone" label and drop
 * the chore from the other children's boards instead of marking it done there.
 */
describe('shared chores', () => {
  const userId = (name: string) => ({
    entity_id: `sensor.${name.toLowerCase()}_choreops_points`,
    state: '0',
    attributes: { purpose: 'purpose_points', user_name: name },
  });

  const choreStatus = (user: string, status: string, extra: Record<string, unknown> = {}) => ({
    entity_id: `sensor.${user.toLowerCase()}_choreops_chore_status_tafeldekken`,
    state: status,
    attributes: {
      purpose: 'purpose_chore_status',
      user_name: user,
      chore_name: 'Tafel dekken',
      default_points: 5,
      ...extra,
    },
  });

  const users = [userId('Maya'), userId('Nova')];

  it('labels a first-come chore as anyone, even under each child', () => {
    const view = buildChorePlannerView(
      normalizeChoreOps([
        ...users,
        choreStatus('Maya', 'pending', {
          completion_criteria: 'shared_first',
          assigned_user_names: ['Maya', 'Nova'],
        }),
        choreStatus('Nova', 'pending', {
          completion_criteria: 'shared_first',
          assigned_user_names: ['Maya', 'Nova'],
        }),
      ]),
      [],
    );

    expect(view.tasks).toHaveLength(2);
    expect(view.tasks.every((task) => task.audience === 'anyone')).toBe(true);
  });

  it('labels a chore assigned to the whole household as everyone', () => {
    const view = buildChorePlannerView(
      normalizeChoreOps([
        ...users,
        choreStatus('Maya', 'pending', {
          completion_criteria: 'independent',
          assigned_user_names: ['Maya', 'Nova'],
        }),
        choreStatus('Nova', 'pending', {
          completion_criteria: 'independent',
          assigned_user_names: ['Maya', 'Nova'],
        }),
      ]),
      [],
    );

    expect(view.tasks.every((task) => task.audience === 'everyone')).toBe(true);
  });

  it('drops the chore from the children somebody else already took it from', () => {
    const view = buildChorePlannerView(
      normalizeChoreOps([
        ...users,
        choreStatus('Maya', 'claimed', {
          completion_criteria: 'shared_first',
          assigned_user_names: ['Maya', 'Nova'],
        }),
        choreStatus('Nova', 'completed_by_other', {
          completion_criteria: 'shared_first',
          assigned_user_names: ['Maya', 'Nova'],
        }),
      ]),
      [],
    );

    expect(view.tasks.map((task) => task.name)).toEqual(['Tafel dekken']);
    expect(view.tasks[0].awaitingReview).toBe(true);
    // Only the child who took it keeps the card (and the points).
    expect(view.tasks[0].memberId).toBe('choreops:maya');
  });

  it('shows a claimed first-come chore as an ordinary assigned chore', () => {
    const view = buildChorePlannerView(
      normalizeChoreOps([
        ...users,
        choreStatus('Maya', 'claimed', {
          completion_criteria: 'shared_first',
          assigned_user_names: ['Maya', 'Nova'],
        }),
        choreStatus('Nova', 'completed_by_other', {
          completion_criteria: 'shared_first',
          assigned_user_names: ['Maya', 'Nova'],
        }),
      ]),
      [],
    );

    // No longer "anyone": it is Maya's chore until ChoreOps resets it, so the
    // card shows her name instead of the race label.
    expect(view.tasks[0].audience).toBe('member');
  });
});

/**
 * Routines are the daily chores ChoreOps already has, grouped by the label the
 * household gave them ("Ochtendroutine"). Completions only count for the day
 * they happened, because a daily chore restarts the next morning.
 */
describe('daily routines', () => {
  const points = {
    entity_id: 'sensor.maya_choreops_points',
    state: '0',
    attributes: { purpose: 'purpose_points', user_name: 'Maya' },
  };

  const dailyChore = (
    name: string,
    extra: Record<string, unknown> = {},
    status = 'pending',
    slug = 'tanden',
  ) => ({
    entity_id: `sensor.maya_choreops_chore_status_${slug}`,
    state: status,
    attributes: {
      purpose: 'purpose_chore_status',
      user_name: 'Maya',
      chore_name: name,
      default_points: 2,
      recurring_frequency: 'daily',
      completion_criteria: 'independent',
      assigned_user_names: ['Maya'],
      ...extra,
    },
  });

  it('groups daily chores by their ChoreOps label', () => {
    const view = buildChorePlannerView(
      normalizeChoreOps([
        points,
        dailyChore('Tanden poetsen', {
          labels: ['Ochtendroutine'],
          due_date: '2026-11-06T07:30:00',
        }),
        dailyChore(
          'Aankleden',
          { labels: ['Ochtendroutine'], due_date: '2026-11-06T07:45:00' },
          'pending',
          'aankleden',
        ),
        dailyChore(
          'Taken uitzoeken',
          { recurring_frequency: 'weekly', labels: ['Ochtendroutine'] },
          'pending',
          'huiswerk',
        ),
      ]),
      [],
      new Date('2026-11-06T09:00:00'),
    );

    expect(view.routines).toHaveLength(1);
    expect(view.routines[0]).toMatchObject({
      name: 'Ochtendroutine',
      frequency: 'daily',
      timeBlock: 'morning',
      points: 4,
    });
    expect(view.routines[0].memberIds).toEqual(['choreops:maya']);
  });

  it('does not invent a routine for daily chores without a label', () => {
    const view = buildChorePlannerView(
      normalizeChoreOps([points, dailyChore('Tanden poetsen')]),
      [],
      new Date('2026-11-06T09:00:00'),
    );

    // No routine was named in ChoreOps, so no routines bar is shown at all.
    expect(view.routines).toEqual([]);
    // The chore itself still shows up as a normal task.
    expect(view.tasks).toHaveLength(1);
  });

  it('drops a daily chore finished on an earlier day from the board', () => {
    const view = buildChorePlannerView(
      normalizeChoreOps([
        points,
        dailyChore('Tanden poetsen', { last_completed: '2026-11-05T07:30:00' }, 'approved'),
      ]),
      [],
      new Date('2026-11-06T09:00:00'),
    );

    expect(view.tasks).toHaveLength(0);
  });

  it('keeps a daily chore finished today', () => {
    const view = buildChorePlannerView(
      normalizeChoreOps([
        points,
        dailyChore('Tanden poetsen', { last_completed: '2026-11-06T07:30:00' }, 'approved'),
      ]),
      [],
      new Date('2026-11-06T09:00:00'),
    );

    expect(view.tasks).toHaveLength(1);
    expect(view.tasks[0].statusOverride).toBe('completed');
  });

  it('keeps old completions for chores that do not repeat daily', () => {
    const view = buildChorePlannerView(
      normalizeChoreOps([
        points,
        dailyChore(
          'Garage opruimen',
          { recurring_frequency: 'none', last_completed: '2026-10-01T07:30:00' },
          'approved',
          'garage',
        ),
      ]),
      [],
      new Date('2026-11-06T09:00:00'),
    );

    expect(view.tasks).toHaveLength(1);
  });
});

/**
 * Phase 7: the two rules that were only implied before — a zero-point chore is
 * still a real chore, and a rejected completion is not an approved one.
 */
describe('points and approval edge cases', () => {
  const choreState = (overrides: Record<string, unknown>) =>
    normalizeChoreOps([
      {
        entity_id: 'sensor.maya_choreops_points',
        state: '12',
        attributes: { purpose: 'purpose_points', user_name: 'Maya' },
      },
      {
        entity_id: 'sensor.maya_choreops_chore_status_planten',
        state: typeof overrides.status === 'string' ? overrides.status : 'pending',
        attributes: {
          purpose: 'purpose_chore_status',
          user_name: 'Maya',
          chore_name: 'Planten water geven',
          assigned_user_names: ['Maya'],
          default_points: 0,
          completion_criteria: 'independent',
          auto_approve: false,
          ...overrides,
        },
      },
    ]);

  it('keeps a zero-point chore, and completes it without points', () => {
    const active = buildChorePlannerView(choreState({}), family);
    const task = active.tasks.find((item) => item.name === 'Planten water geven')!;
    expect(task.points).toBe(0);
    expect(task.statusOverride).toBe('active');

    const done = buildChorePlannerView(choreState({ status: 'completed' }), family);
    const finished = done.tasks.find((item) => item.name === 'Planten water geven')!;
    expect(finished.statusOverride).toBe('completed');
    expect(finished.points).toBe(0);
  });

  it('treats a claimed chore as awaiting approval, not as approved', () => {
    const view = buildChorePlannerView(choreState({ status: 'claimed' }), family);
    const task = view.tasks.find((item) => item.name === 'Planten water geven')!;
    expect(task.awaitingReview).toBe(true);
    expect(task.statusOverride).not.toBe('completed');
  });

  it('leaves a rejected completion active and out of the completed list', () => {
    // ChoreOps sends a disapproved chore back to the child; it must not read as
    // approved, and the points stay with the child's balance.
    for (const rejected of ['pending', 'overdue', 'missed']) {
      const view = buildChorePlannerView(choreState({ status: rejected }), family);
      const task = view.tasks.find((item) => item.name === 'Planten water geven')!;
      expect(task.statusOverride).not.toBe('completed');
      expect(task.awaitingReview).toBe(false);
    }
    expect(choreOpsTaskStatus('disapproved')).not.toBe('completed');
  });

  it('exposes auto-approve so the child can finish without a parent', () => {
    const view = buildChorePlannerView(choreState({ auto_approve: true }), family);
    const task = view.tasks.find((item) => item.name === 'Planten water geven')!;
    expect(task.autoApprove).toBe(true);
  });
});
