import { describe, it, expect } from 'vitest';
import {
  buildCreateChorePayload,
  groupChoreOpsChores,
  normalizeChoreOps,
  CHOREOPS_ALL_USERS,
} from './choreops';
import type { ChoreOpsChore, ChoreOpsUser } from '../types/choreops';
import type { FamilyMember } from '../types/family';

describe('buildCreateChorePayload', () => {
  it('requires a config entry, a name, and at least one assignee', () => {
    expect(
      buildCreateChorePayload({ entryId: null, name: 'Afwassen', assignedUserNames: ['Maya'] }),
    ).toBeNull();
    expect(
      buildCreateChorePayload({ entryId: 'e1', name: '   ', assignedUserNames: ['Maya'] }),
    ).toBeNull();
    expect(
      buildCreateChorePayload({ entryId: 'e1', name: 'Afwassen', assignedUserNames: ['  '] }),
    ).toBeNull();
  });

  /*
   * "Free for anyone to claim" is ChoreOps' `*` sentinel. An empty assignee
   * list would create a dormant chore with no entities at all, which is why
   * those chores never showed up after being saved.
   */
  it('creates open-to-anyone chores with the all-users sentinel', () => {
    const payload = buildCreateChorePayload({
      entryId: 'entry-1',
      name: 'Tafel dekken',
      assignedUserNames: [CHOREOPS_ALL_USERS],
      completionCriteria: 'shared_first',
    });

    expect(payload).toEqual({
      config_entry_id: 'entry-1',
      name: 'Tafel dekken',
      assigned_user_names: ['*'],
      completion_criteria: 'shared_first',
    });
  });

  it('sends only the fields the user set, with sane points rounding', () => {
    const payload = buildCreateChorePayload({
      entryId: 'entry-1',
      name: '  Afwassen  ',
      assignedUserNames: ['Maya', 'Maya', ' Nova '],
      points: 4.6,
    });

    expect(payload).toEqual({
      config_entry_id: 'entry-1',
      name: 'Afwassen',
      assigned_user_names: ['Maya', 'Nova'],
      points: 5,
    });
  });

  it('sends the routine label so Abbai Flow can group daily chores', () => {
    const payload = buildCreateChorePayload({
      entryId: 'entry-1',
      name: 'Tanden poetsen',
      assignedUserNames: ['Maya'],
      frequency: 'daily',
      labels: ['  Ochtendroutine  ', '', 'Ochtendroutine'],
    });

    expect(payload).toMatchObject({
      frequency: 'daily',
      labels: ['Ochtendroutine'],
    });

    // No label typed → nothing sent, so ChoreOps keeps its own labels.
    const unlabeled = buildCreateChorePayload({
      entryId: 'entry-1',
      name: 'Tanden poetsen',
      assignedUserNames: ['Maya'],
      labels: ['   '],
    });
    expect(unlabeled).not.toHaveProperty('labels');
  });

  it('sends weekly weekdays and custom interval only when relevant', () => {
    const weekly = buildCreateChorePayload({
      entryId: 'entry-1',
      name: 'Stofzuigen',
      assignedUserNames: ['Maya'],
      frequency: 'weekly',
      applicableDays: ['mon', 'thu'],
      customInterval: 3,
    });
    expect(weekly).toMatchObject({ frequency: 'weekly', applicable_days: ['mon', 'thu'] });
    expect(weekly).not.toHaveProperty('custom_interval');

    const custom = buildCreateChorePayload({
      entryId: 'entry-1',
      name: 'Planten',
      assignedUserNames: ['Nova'],
      frequency: 'custom',
      customInterval: 2,
      customIntervalUnit: 'weeks',
      applicableDays: ['mon'],
    });
    expect(custom).toMatchObject({ custom_interval: 2, custom_interval_unit: 'weeks' });
    expect(custom).not.toHaveProperty('applicable_days');
  });
});

/**
 * The dashboard helper's `chores` attribute is empty whenever nothing is due,
 * so the chores screen had nothing to render even though ChoreOps publishes a
 * claim/approve/disapprove button per chore. The list is built from those
 * buttons now; these tests pin that down.
 */

const btn = (purpose: string, user: string, chore: string, id: string) => ({
  entity_id: id,
  state: 'unknown',
  attributes: { purpose, user_name: user, chore_name: chore },
});

describe('normalizeChoreOps — per-chore buttons', () => {
  it('lists chores from the action buttons even with no dashboard-helper items', () => {
    const result = normalizeChoreOps([
      {
        entity_id: 'sensor.maya_choreops_points',
        state: '42',
        attributes: { purpose: 'purpose_points', user_name: 'Maya' },
      },
      {
        entity_id: 'sensor.maya_choreops_ui_dashboard_helper',
        state: 'ok',
        attributes: { purpose: 'purpose_dashboard_helper', user_name: 'Maya', chores: [] },
      },
      btn(
        'purpose_button_chore_claim',
        'Maya',
        'Stofzuigen beneden',
        'button.maya_choreops_claim_chore_stofzuigenbe_beneden',
      ),
      btn(
        'purpose_button_chore_approve',
        'Maya',
        'Stofzuigen beneden',
        'button.maya_choreops_approve_chore_stofzuigenbe_beneden',
      ),
      btn(
        'purpose_button_chore_disapprove',
        'Maya',
        'Stofzuigen beneden',
        'button.maya_choreops_disapprove_chore_stofzuigenbe_beneden',
      ),
    ]);

    expect(result.chores).toHaveLength(1);
    expect(result.chores[0]).toMatchObject({
      name: 'Stofzuigen beneden',
      assignee: 'Maya',
      canClaim: true,
      canApprove: true,
      actions: {
        claim: 'button.maya_choreops_claim_chore_stofzuigenbe_beneden',
        approve: 'button.maya_choreops_approve_chore_stofzuigenbe_beneden',
        disapprove: 'button.maya_choreops_disapprove_chore_stofzuigenbe_beneden',
      },
    });
    expect(result.available).toBe(true);
  });

  it('keeps the same chore separate per user', () => {
    const result = normalizeChoreOps([
      btn(
        'purpose_button_chore_claim',
        'Maya',
        'Afwassen',
        'button.maya_choreops_claim_chore_afwassen',
      ),
      btn(
        'purpose_button_chore_claim',
        'Zara',
        'Afwassen',
        'button.zara_choreops_claim_chore_afwassen',
      ),
    ]);

    expect(result.chores).toHaveLength(2);
    expect(result.chores.map((c) => c.assignee).sort()).toEqual(['Maya', 'Zara']);
  });

  it('merges dashboard-helper metadata with button actions', () => {
    const result = normalizeChoreOps([
      {
        entity_id: 'sensor.maya_choreops_ui_dashboard_helper',
        state: 'ok',
        attributes: {
          purpose: 'purpose_dashboard_helper',
          user_name: 'Maya',
          chores: [{ eid: 'e-1', name: 'Afwassen', status: 'claimed', icon: '\u{1F37D}' }],
        },
      },
      btn(
        'purpose_button_chore_claim',
        'Maya',
        'Afwassen',
        'button.maya_choreops_claim_chore_afwassen',
      ),
    ]);

    expect(result.chores).toHaveLength(1);
    expect(result.chores[0]).toMatchObject({
      id: 'e-1',
      status: 'claimed',
      icon: '\u{1F37D}',
      actions: { claim: 'button.maya_choreops_claim_chore_afwassen' },
    });
  });

  it('attaches reward claim buttons to the reward status sensor', () => {
    const result = normalizeChoreOps([
      {
        entity_id: 'sensor.maya_choreops_reward_status_meer_scherm_tijd',
        state: 'available',
        attributes: {
          purpose: 'purpose_reward_status',
          reward_name: 'Meer scherm tijd',
          cost: 200,
        },
      },
      {
        entity_id: 'button.maya_choreops_claim_reward_meer_scherm_tijd',
        state: 'unknown',
        attributes: {
          purpose: 'purpose_button_reward_redeem',
          user_name: 'Maya',
          reward_name: 'Meer scherm tijd',
        },
      },
    ]);

    expect(result.rewards).toHaveLength(1);
    expect(result.rewards[0]).toMatchObject({
      name: 'Meer scherm tijd',
      cost: 200,
      actions: { claim: 'button.maya_choreops_claim_reward_meer_scherm_tijd' },
    });
  });
});

/**
 * `sensor.system_choreops_<chore>_global_status` (purpose_shared_chore) is the
 * only household-wide chore inventory: it exists whether or not the chore is
 * assigned, and it carries the points value the buttons lack.
 */
describe('normalizeChoreOps � shared chore records', () => {
  const sharedChore = (name: string, assignees: string[], extra: Record<string, unknown> = {}) => ({
    entity_id: `sensor.system_choreops_${name.toLowerCase().replace(/\s+/g, '_')}_global_status`,
    state: 'due',
    attributes: {
      purpose: 'purpose_shared_chore',
      chore_name: name,
      assigned_user_names: assignees,
      default_points: 2,
      icon: 'mdi:vacuum-outline',
      ...extra,
    },
  });

  it('creates one card per assignee, with the chore points', () => {
    const result = normalizeChoreOps([sharedChore('Afwassen', ['Maya', 'Zara'])]);

    expect(result.chores).toHaveLength(2);
    expect(result.chores.map((c) => c.assignee).sort()).toEqual(['Maya', 'Zara']);
    expect(result.chores.every((c) => c.points === 2)).toBe(true);
    expect(result.chores.every((c) => c.status === 'due')).toBe(true);
  });

  it('keeps an unassigned chore as a single everyone-card', () => {
    const result = normalizeChoreOps([sharedChore('Gang opruimen', [])]);

    expect(result.chores).toHaveLength(1);
    expect(result.chores[0]).toMatchObject({ name: 'Gang opruimen', assignee: null });
    // Nothing to press: ChoreOps only publishes claim buttons per assignment.
    expect(result.chores[0].actions).toEqual({});
  });

  it('attaches each user claim button to their own copy of the chore', () => {
    const result = normalizeChoreOps([
      sharedChore('Afwassen', ['Maya', 'Zara']),
      btn(
        'purpose_button_chore_claim',
        'Maya',
        'Afwassen',
        'button.maya_choreops_claim_chore_afwassen',
      ),
      btn(
        'purpose_button_chore_claim',
        'Zara',
        'Afwassen',
        'button.zara_choreops_claim_chore_afwassen',
      ),
    ]);

    const maya = result.chores.find((c) => c.assignee === 'Maya');
    const zara = result.chores.find((c) => c.assignee === 'Zara');
    expect(maya?.actions.claim).toBe('button.maya_choreops_claim_chore_afwassen');
    expect(zara?.actions.claim).toBe('button.zara_choreops_claim_chore_afwassen');
    expect(maya?.points).toBe(2);
  });

  it('reads the household pending-approval counters', () => {
    const result = normalizeChoreOps([
      {
        entity_id: 'sensor.system_choreops_pending_chore_approvals',
        state: '3',
        attributes: { purpose: 'purpose_sensor_chores_pending_approval_extra' },
      },
      {
        entity_id: 'sensor.system_choreops_pending_reward_approvals',
        state: '1',
        attributes: { purpose: 'purpose_sensor_rewards_pending_approval_extra' },
      },
    ]);

    expect(result.pendingApprovals).toEqual({ chores: 3, rewards: 1 });
  });

  it('gives each assignee a unique id so React does not collapse the cards', () => {
    // One sensor covers every assignee; using its entity_id as the card id made
    // two children share a React key.
    const result = normalizeChoreOps([sharedChore('Tanden poetsen', ['Maya', 'Zara'])]);
    const ids = result.chores.map((c) => c.id);

    expect(new Set(ids).size).toBe(2);
  });
});

describe('normalizeChoreOps — per-user chore status', () => {
  it('uses the per-user status sensor as the chore status', () => {
    // The shared-chore sensor lags behind; the per-user one is authoritative.
    const result = normalizeChoreOps([
      {
        entity_id: 'sensor.system_choreops_bed_opmaken_global_status',
        state: 'due',
        attributes: {
          purpose: 'purpose_shared_chore',
          chore_name: 'Bed opmaken',
          assigned_user_names: ['Nova'],
        },
      },
      {
        entity_id: 'sensor.nova_choreops_chore_status_bed_opmaken',
        state: 'claimed',
        attributes: {
          purpose: 'purpose_chore_status',
          user_name: 'Nova',
          chore_name: 'Bed opmaken',
        },
      },
    ]);

    expect(result.chores).toHaveLength(1);
    expect(result.chores[0]).toMatchObject({ name: 'Bed opmaken', status: 'claimed' });
  });

  it('adds a card for a status sensor whose buttons have not been seen yet', () => {
    const result = normalizeChoreOps([
      {
        entity_id: 'sensor.nova_choreops_chore_status_bed_opmaken',
        state: 'claimed',
        attributes: {
          purpose: 'purpose_chore_status',
          user_name: 'Nova',
          chore_name: 'Bed opmaken',
        },
      },
    ]);

    expect(result.chores).toHaveLength(1);
    expect(result.chores[0]).toMatchObject({ name: 'Bed opmaken', assignee: 'Nova' });
  });

  it('exposes the ChoreOps config entry id for service calls', () => {
    const result = normalizeChoreOps([
      {
        entity_id: 'sensor.system_choreops_dashboard_helper',
        state: 'ok',
        attributes: {
          purpose: 'purpose_system_dashboard_helper',
          integration_entry_id: 'entry-123',
        },
      },
    ]);

    expect(result.entryId).toBe('entry-123');
  });
});

describe('groupChoreOpsChores', () => {
  const users: ChoreOpsUser[] = ['Maya', 'Nova', 'Zara'].map((name) => ({
    name,
    slug: name.toLowerCase(),
    points: 0,
    dueToday: 0,
    claimed: 0,
    approved: 0,
    completedToday: 0,
  }));
  const members: FamilyMember[] = [
    {
      id: 'maya-id',
      name: 'Maya',
      avatar: '👧',
      color: '#3b82f6',
      role: 'child',
      choreops_user: 'Maya',
    },
    {
      id: 'zara-id',
      name: 'Zara',
      avatar: '👧',
      color: '#22c55e',
      role: 'child',
      choreops_user: 'Zara',
    },
  ];
  const assignedChore = (id: string, name: string, assignee: string | null): ChoreOpsChore => ({
    id,
    name,
    assignee,
    icon: null,
    status: 'due',
    points: null,
    canClaim: true,
    canApprove: false,
    actions: {},
  });

  it('creates a column for every ChoreOps user, including users with no chores', () => {
    const groups = groupChoreOpsChores(
      users,
      [assignedChore('m1', 'Make bed', 'Maya')],
      members,
      'Shared',
    );

    expect(groups.map((group) => group.label)).toEqual(['Maya', 'Nova', 'Zara']);
    expect(groups.find((group) => group.label === 'Nova')?.chores).toEqual([]);
  });

  it('keeps unlinked users in distinct columns and reserves Shared for unassigned chores', () => {
    const groups = groupChoreOpsChores(
      users,
      [assignedChore('n1', 'Feed cat', 'Nova'), assignedChore('s1', 'Tidy hall', null)],
      members,
      'Shared',
    );

    expect(groups.find((group) => group.label === 'Nova')?.chores.map((chore) => chore.id)).toEqual(
      ['n1'],
    );
    expect(
      groups.find((group) => group.label === 'Shared')?.chores.map((chore) => chore.id),
    ).toEqual(['s1']);
  });
});

describe('normalizeChoreOps � unassigned chores', () => {
  it('lists chores that only appear in the ChoreOps chore select', () => {
    const result = normalizeChoreOps([
      {
        entity_id: 'select.system_choreops_choreops_select_label_all_chores',
        state: 'unknown',
        attributes: { purpose: 'purpose_select_chores', options: ['Stofzuigen', 'Lezen'] },
      },
      btn(
        'purpose_button_chore_claim',
        'Maya',
        'Stofzuigen',
        'button.maya_choreops_claim_chore_stofzuigen',
      ),
    ]);

    expect(result.chores.map((c) => c.name).sort()).toEqual(['Lezen', 'Stofzuigen']);

    const lezen = result.chores.find((c) => c.name === 'Lezen');
    expect(lezen).toMatchObject({ assignee: null, status: 'unassigned', actions: {} });

    // Never duplicate a chore that is already known through its claim button.
    expect(result.chores.filter((c) => c.name === 'Stofzuigen')).toHaveLength(1);
  });
});

describe('normalizeChoreOps — per-child rewards', () => {
  it('keeps one reward row per child, even when the reward name repeats', () => {
    const result = normalizeChoreOps([
      {
        entity_id: 'sensor.maya_choreops_reward_status_schermtijd',
        state: 'available',
        attributes: {
          purpose: 'purpose_reward_status',
          user_name: 'Maya',
          reward_name: 'Schermtijd',
          cost: 10,
        },
      },
      {
        entity_id: 'sensor.zara_choreops_reward_status_schermtijd',
        state: 'locked',
        attributes: {
          purpose: 'purpose_reward_status',
          user_name: 'Zara',
          reward_name: 'Schermtijd',
          cost: 10,
        },
      },
      {
        entity_id: 'button.maya_choreops_claim_reward_schermtijd',
        state: 'unknown',
        attributes: {
          purpose: 'purpose_button_reward_redeem',
          user_name: 'Maya',
          reward_name: 'Schermtijd',
        },
      },
    ]);

    expect(result.rewards).toHaveLength(2);
    const maya = result.rewards.find((reward) => reward.assignee === 'Maya');
    const zara = result.rewards.find((reward) => reward.assignee === 'Zara');
    expect(maya).toMatchObject({ cost: 10, status: 'available' });
    expect(maya?.actions.claim).toBe('button.maya_choreops_claim_reward_schermtijd');
    expect(zara).toMatchObject({ cost: 10, status: 'locked' });
    expect(zara?.actions.claim).toBeUndefined();
  });
});
