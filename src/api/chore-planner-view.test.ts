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
