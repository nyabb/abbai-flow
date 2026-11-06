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
