import { describe, it, expect } from 'vitest';
import { normalizeChoreOps } from './choreops';

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
