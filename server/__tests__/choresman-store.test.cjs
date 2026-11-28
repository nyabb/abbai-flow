const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {
  ChoresManStoreError,
  FAMILY_SERVICE_NAMES,
  ChoresManStore,
  SERVICE_NAMES,
} = require('../choresman-store.cjs');

async function fixture(t, initialTime = '2026-01-05T08:00:00.000Z') {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'abbai-choresman-'));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  let now = new Date(initialTime);
  const store = new ChoresManStore({ dataDir, now: () => new Date(now) });
  return {
    store,
    dataDir,
    setNow(value) {
      now = new Date(value);
    },
  };
}

async function addHousehold(store) {
  const parent = await store.call('family.create_member', { name: 'Jamie', role: 'parent', avatar: '👩' });
  const child = await store.call('family.create_member', { name: 'Riley', role: 'child', avatar: '🧒' });
  return { parent, child };
}

function byName(items, name) {
  return items.find((item) => item.name === name);
}

test('exports ChoresMan-compatible action names under the ChoresMan domain prefix', async (t) => {
  const { store } = await fixture(t);
  assert.ok(SERVICE_NAMES.includes('take_chore'));
  assert.ok(SERVICE_NAMES.includes('claim_chore'));
  assert.ok(SERVICE_NAMES.includes('manual_adjust_points'));
  assert.ok(SERVICE_NAMES.includes('reset_all_data'));
  assert.ok(FAMILY_SERVICE_NAMES.includes('create_member'));
  assert.equal((await store.call('family.create_member', { name: 'Riley' })).name, 'Riley');
  await assert.rejects(
    store.call('choresman.not_a_service', {}),
    (error) => error instanceof ChoresManStoreError && error.code === 'service_not_found',
  );
});

test('creates standalone family members and preserves references when a name changes', async (t) => {
  const { store } = await fixture(t);
  const { parent, child } = await addHousehold(store);
  await store.call('create_chore', {
    name: 'Feed the cat',
    assigned_user_names: ['Riley'],
    points: 4,
  });

  const renamed = await store.call('family.update_member', {
    user_id: child.id,
    name: 'Riley A',
    role: 'child',
  });
  const snapshot = await store.getSnapshot();
  assert.equal(renamed.name, 'Riley A');
  assert.equal(snapshot.chores[0].assigned_user_names[0], 'Riley A');
  assert.equal(snapshot.members.find((member) => member.id === parent.id).role, 'parent');
  assert.equal(snapshot.members.find((member) => member.id === child.id).id, child.id);

  await assert.rejects(
    store.call('family.create_member', { name: 'rIlEy a', role: 'child' }),
    (error) => error.code === 'duplicate_user',
  );
  const removed = await store.call('family.delete_member', { user_id: child.id });
  assert.equal(removed.deleted, true);
  assert.equal((await store.getSnapshot()).members.find((member) => member.id === child.id).active, false);
  assert.deepEqual((await store.getSnapshot()).chores[0].assigned_user_names, []);
});

test('creates, updates, assigns, and deletes chores using ChoresMan field names', async (t) => {
  const { store } = await fixture(t);
  const { child } = await addHousehold(store);
  const created = await store.call('choresman.create_chore', {
    config_entry_id: 'legacy-entry-is-ignored',
    name: 'Tidy room',
    assigned_user_names: ['Riley'],
    points: 7,
    frequency: 'weekly',
    applicable_days: ['sat'],
    completion_criteria: 'independent',
    due_date: '2026-01-10T09:00:00Z',
    auto_approve: false,
    labels: ['bedroom'],
  });
  assert.ok(created.chore_id);

  await store.call('update_chore', {
    id: created.chore_id,
    name: 'Tidy bedroom',
    assignment_action: 'add',
    assigned_user_names: ['Jamie'],
    points: 9,
    show_on_calendar: false,
  });
  let chore = byName((await store.getSnapshot()).chores, 'Tidy bedroom');
  assert.deepEqual(chore.assigned_user_names.sort(), ['Jamie', 'Riley']);
  assert.equal(chore.points, 9);
  assert.equal(chore.show_on_calendar, false);
  assert.equal(chore.frequency, 'weekly');

  await store.call('update_chore', {
    name: 'Tidy bedroom',
    assignment_action: 'remove',
    assigned_user_names: ['Jamie'],
    description: 'Put everything away',
  });
  chore = byName((await store.getSnapshot()).chores, 'Tidy bedroom');
  assert.deepEqual(chore.assigned_user_names, ['Riley']);
  assert.equal(chore.description, 'Put everything away');

  await assert.rejects(
    store.call('update_chore', { id: created.chore_id, completion_criteria: 'shared_first' }),
    (error) => error.code === 'immutable_field',
  );
  await store.call('update_chore', { name: 'Tidy bedroom', assigned_user_names: [] });
  assert.deepEqual(byName((await store.getSnapshot()).chores, 'Tidy bedroom').assigned_user_names, []);

  const deleted = await store.call('delete_chore', { id: created.chore_id });
  assert.equal(deleted.deleted, true);
  assert.equal((await store.getSnapshot()).chores.length, 0);
  assert.equal((await store.getDocument()).chore_events.at(-1).type, 'chore_deleted');
  assert.ok(child.id);
});

test('stores ChoresMan per-member day and multi-time schedules against stable member IDs', async (t) => {
  const { store } = await fixture(t);
  await store.call('family.sync_members', {
    members: [
      { id: 'parent-profile', name: 'Jamie', role: 'parent' },
      { id: 'child-profile', name: 'Riley', role: 'child' },
    ],
  });
  const created = await store.call('create_chore', {
    name: 'Custom schedule', assigned_user_names: ['Riley'], frequency: 'daily_multi',
    daily_multi_times_by_member: { Riley: ['08:00', '19:30'] },
    applicable_days_by_member: { Riley: ['mon', 'wed', 'fri'] },
  });
  const document = await store.getDocument();
  const chore = document.chores.find((entry) => entry.id === created.chore_id);
  assert.deepEqual(chore.daily_multi_times_by_member['child-profile'], ['08:00', '19:30']);
  assert.deepEqual(chore.applicable_days_by_member['child-profile'], ['mon', 'wed', 'fri']);
});

test('claims, approvals and disapprovals update workflow history and points ledger', async (t) => {
  const { store } = await fixture(t);
  await addHousehold(store);
  const chore = await store.call('create_chore', {
    name: 'Make bed',
    assigned_user_names: ['Riley'],
    points: 6,
  });

  const claim = await store.call('claim_chore', { user_name: 'Riley', chore_name: 'Make bed' });
  assert.equal(claim.status, 'claimed');
  assert.equal((await store.getSnapshot()).pending_approvals.chores, 1);
  await assert.rejects(
    store.call('claim_chore', { user_name: 'Riley', chore_name: 'Make bed' }),
    (error) => error.code === 'chore_already_claimed',
  );

  const disapproved = await store.call('disapprove_chore', {
    approver_name: 'Jamie',
    user_name: 'Riley',
    chore_name: 'Make bed',
  });
  assert.equal(disapproved.status, 'disapproved');
  const retry = await store.call('claim_chore', { user_name: 'Riley', chore_name: 'Make bed' });
  const approved = await store.call('approve_chore', {
    approver_name: 'Jamie',
    user_name: 'Riley',
    chore_name: 'Make bed',
    points_awarded: 5,
  });
  assert.equal(approved.status, 'approved');
  assert.equal(approved.points_awarded, 5);
  assert.equal((await store.getSnapshot()).members.find((member) => member.name === 'Riley').points, 5);
  assert.equal(retry.claim_id, claim.claim_id);
  await assert.rejects(
    store.call('approve_chore', { approver_name: 'Jamie', user_name: 'Riley', chore_name: 'Make bed' }),
    (error) => error.code === 'claim_not_pending',
  );
  assert.equal((await store.getSnapshot()).pending_approvals.chores, 0);
  assert.equal((await store.call('get_ledger', { user_name: 'Riley' })).entries[0].item_name, 'Make bed');
  assert.equal(chore.name, 'Make bed');
});

test('taking a shared-first chore reserves it, and completion then waits for approval', async (t) => {
  const { store } = await fixture(t);
  await addHousehold(store);
  await store.call('create_chore', {
    name: 'Set the table',
    assigned_user_names: ['*'],
    points: 3,
    completion_criteria: 'shared_first',
  });

  const take = await store.call('take_chore', { user_name: 'Riley', chore_name: 'Set the table' });
  let snapshot = await store.getSnapshot();
  assert.equal(take.status, 'in_progress');
  assert.equal(snapshot.chores[0].status_by_member.Riley.status, 'in_progress');
  assert.equal(snapshot.chores[0].status_by_member.Riley.last_completed, null);
  assert.equal(snapshot.pending_approvals.chores, 0);
  assert.equal(snapshot.members.find((member) => member.name === 'Riley').points, 0);
  await assert.rejects(
    store.call('take_chore', { user_name: 'Jamie', chore_name: 'Set the table' }),
    (error) => error.code === 'chore_already_claimed',
  );

  const completion = await store.call('claim_chore', { user_name: 'Riley', chore_name: 'Set the table' });
  snapshot = await store.getSnapshot();
  assert.equal(completion.status, 'claimed');
  assert.equal(snapshot.chores[0].status_by_member.Riley.status, 'claimed');
  assert.equal(snapshot.pending_approvals.chores, 1);
  assert.equal(snapshot.members.find((member) => member.name === 'Riley').points, 0);
});

test('automatic approval runs after a shared-first chore is completed, not when it is taken', async (t) => {
  const { store } = await fixture(t);
  await addHousehold(store);
  await store.call('create_chore', {
    name: 'Set the table',
    assigned_user_names: ['*'],
    points: 3,
    completion_criteria: 'shared_first',
    auto_approve: true,
  });
  const take = await store.call('take_chore', { user_name: 'Riley', chore_name: 'Set the table' });
  assert.equal(take.status, 'in_progress');
  assert.equal((await store.getSnapshot()).members.find((member) => member.name === 'Riley').points, 0);
  assert.equal((await store.getSnapshot()).pending_approvals.chores, 0);

  const claim = await store.call('claim_chore', { user_name: 'Riley', chore_name: 'Set the table' });
  assert.equal(claim.status, 'approved');
  const snapshot = await store.getSnapshot();
  assert.equal(snapshot.chores[0].status_by_member.Riley.status, 'approved');
  assert.equal(typeof snapshot.chores[0].status_by_member.Riley.last_completed, 'string');
  assert.equal(snapshot.members.find((member) => member.name === 'Riley').points, 3);
  await assert.rejects(
    store.call('take_chore', { user_name: 'Jamie', chore_name: 'Set the table' }),
    (error) => error.code === 'chore_already_claimed',
  );
});

test('uses Abbai Flow profile IDs and refreshed profile data as ChoresMan family identity', async (t) => {
  const { store } = await fixture(t);
  await store.call('family.create_member', { id: 'legacy-child-id', name: 'Riley', role: 'child' });
  const chore = await store.call('create_chore', { name: 'Feed the cat', assigned_user_names: ['Riley'] });
  const profiles = [
    { id: 'abbai-parent-id', name: 'Jamie', role: 'parent', avatar: '👩', color: '#112233' },
    { id: 'abbai-child-id', name: 'Riley', role: 'child', avatar: '🧒', color: '#445566' },
  ];
  await store.call('family.sync_members', { members: profiles });
  const renamed = profiles.map((profile) => profile.id === 'abbai-child-id'
    ? { ...profile, name: 'Riley A', role: 'parent' }
    : profile);
  await store.call('family.sync_members', { members: renamed });

  const snapshot = await store.getSnapshot();
  const child = snapshot.members.find((member) => member.id === 'abbai-child-id');
  assert.equal(child.family_member_id, 'abbai-child-id');
  assert.equal(child.name, 'Riley A');
  assert.equal(child.role, 'parent');
  assert.deepEqual(snapshot.members.map((member) => member.id).sort(), ['abbai-child-id', 'abbai-parent-id']);
  assert.deepEqual((await store.getDocument()).chores.find((entry) => entry.id === chore.chore_id).assigned_member_ids, ['abbai-child-id']);
  assert.deepEqual(snapshot.chores.find((entry) => entry.id === chore.chore_id).assigned_user_names, ['Riley A']);
});

test('shared-all chores track and award each assigned member separately', async (t) => {
  const { store } = await fixture(t);
  await addHousehold(store);
  await store.call('create_chore', {
    name: 'Clear the table',
    assigned_user_names: ['Jamie', 'Riley'],
    points: 2,
    completion_criteria: 'shared_all',
  });

  for (const userName of ['Riley', 'Jamie']) {
    await store.call('claim_chore', { user_name: userName, chore_name: 'Clear the table' });
    await store.call('approve_chore', {
      approver_name: 'Jamie',
      user_name: userName,
      chore_name: 'Clear the table',
    });
  }

  const snapshot = await store.getSnapshot();
  assert.equal(snapshot.members.find((member) => member.name === 'Riley').points, 2);
  assert.equal(snapshot.members.find((member) => member.name === 'Jamie').points, 2);
  assert.equal(snapshot.chore_claims.filter((claim) => claim.status === 'approved').length, 2);
});

test('claim validation respects assignments, pauses, and claim windows', async (t) => {
  const { store, setNow } = await fixture(t);
  await addHousehold(store);
  await store.call('create_chore', {
    name: 'Take out rubbish',
    assigned_user_names: ['Riley'],
    frequency: 'weekly',
    due_date: '2026-01-06T09:00:00.000Z',
    due_window_offset: '1h',
    chore_claim_lock_until_window: true,
  });
  await assert.rejects(
    store.call('claim_chore', { user_name: 'Jamie', chore_name: 'Take out rubbish' }),
    (error) => error.code === 'user_not_assigned',
  );
  await assert.rejects(
    store.call('claim_chore', { user_name: 'Riley', chore_name: 'Take out rubbish' }),
    (error) => error.code === 'claim_window_closed',
  );
  setNow('2026-01-06T08:30:00.000Z');
  await store.call('claim_chore', { user_name: 'Riley', chore_name: 'Take out rubbish' });
  await store.call('disapprove_chore', {
    approver_name: 'Jamie',
    user_name: 'Riley',
    chore_name: 'Take out rubbish',
  });
  await store.call('pause_user_chores', { user_name: 'Riley', paused: true });
  setNow('2026-01-06T10:00:00.000Z');
  await assert.rejects(
    store.call('claim_chore', { user_name: 'Riley', chore_name: 'Take out rubbish' }),
    (error) => error.code === 'user_paused',
  );
  const unpaused = await store.call('pause_user_chores', { user_name: 'Riley', paused: false });
  assert.equal(unpaused.paused, false);
  assert.equal((await store.call('claim_chore', { user_name: 'Riley', chore_name: 'Take out rubbish' })).status, 'claimed');
});

test('due-date services set, clear, reset, and advance a recurring chore', async (t) => {
  const { store, setNow } = await fixture(t, '2026-01-05T08:00:00.000Z');
  await addHousehold(store);
  const created = await store.call('create_chore', {
    name: 'Water plants',
    assigned_user_names: ['Riley'],
    frequency: 'weekly',
    applicable_days: ['wed', 'sat'],
    due_date: '2026-01-05T09:00:00.000Z',
  });
  await store.call('claim_chore', { user_name: 'Riley', chore_name: 'Water plants' });
  setNow('2026-01-05T10:00:00.000Z');
  await store.call('approve_chore', {
    approver_name: 'Jamie',
    user_name: 'Riley',
    chore_name: 'Water plants',
  });
  let chore = (await store.getSnapshot()).chores[0];
  assert.equal(chore.due_date, '2026-01-07T09:00:00.000Z');

  const set = await store.call('set_chore_due_date', {
    chore_name: 'Water plants',
    user_name: 'Riley',
    due_date: '2026-01-20T11:30:00Z',
  });
  assert.equal(set.due_date, '2026-01-20T11:30:00.000Z');
  chore = byName((await store.getSnapshot()).chores, 'Water plants');
  assert.equal(chore.due_date_by_member[created.chore_id] ?? null, null);
  assert.equal(chore.due_date_by_member[(await store.getSnapshot()).members.find((member) => member.name === 'Riley').id], '2026-01-20T11:30:00.000Z');

  const skipped = await store.call('skip_chore_due_date', { chore_name: 'Water plants', user_name: 'Riley', mark_as_missed: true });
  assert.equal(skipped.next_due_date, '2026-01-21T11:30:00.000Z');
  const cleared = await store.call('set_chore_due_date', { chore_name: 'Water plants', due_date: null });
  assert.equal(cleared.due_date, null);
  assert.deepEqual((await store.getSnapshot()).chores[0].due_date_by_member, {});
});

test('reward CRUD and request/approve/reject workflows reserve and spend points', async (t) => {
  const { store } = await fixture(t);
  await addHousehold(store);
  await store.call('manual_adjust_points', { user_name: 'Riley', amount: 12, reason: 'Welcome points' });
  const reward = await store.call('create_reward', {
    name: 'Choose a movie',
    cost: 8,
    assigned_user_names: ['Riley'],
    description: 'Family movie night',
  });
  await store.call('update_reward', { id: reward.reward_id, cost: 10, labels: ['family'] });
  let currentReward = byName((await store.getSnapshot()).rewards, 'Choose a movie');
  assert.equal(currentReward.cost, 10);
  assert.deepEqual(currentReward.labels, ['family']);

  const request = await store.call('redeem_reward', {
    approver_name: 'Jamie',
    user_name: 'Riley',
    reward_name: 'Choose a movie',
  });
  assert.equal(request.status, 'pending');
  await assert.rejects(
    store.call('redeem_reward', { approver_name: 'Jamie', user_name: 'Riley', reward_name: 'Choose a movie' }),
    (error) => error.code === 'reward_already_pending',
  );
  const approval = await store.call('approve_reward', {
    approver_name: 'Jamie',
    user_name: 'Riley',
    reward_name: 'Choose a movie',
    cost_override: 9,
  });
  assert.equal(approval.cost, 9);
  assert.equal((await store.getSnapshot()).members.find((member) => member.name === 'Riley').points, 3);
  assert.equal((await store.getSnapshot()).pending_approvals.rewards, 0);

  await assert.rejects(
    store.call('approve_reward', { approver_name: 'Jamie', user_name: 'Riley', reward_name: 'Choose a movie' }),
    (error) => error.code === 'insufficient_points',
  );
  await store.call('delete_reward', { id: reward.reward_id });
  assert.equal((await store.getSnapshot()).rewards.length, 0);
});

test('reward proposals need parent approval before redemption', async (t) => {
  const { store } = await fixture(t);
  await addHousehold(store);
  await store.call('manual_adjust_points', { user_name: 'Riley', amount: 12, reason: 'Welcome points' });
  const proposal = await store.call('create_reward', {
    name: 'Movie night',
    cost: 8,
    assigned_user_names: ['Riley'],
    approved: false,
  });

  const stored = byName((await store.getSnapshot()).rewards, 'Movie night');
  assert.equal(stored.approved, false);
  await assert.rejects(
    store.call('redeem_reward', { user_name: 'Riley', reward_name: 'Movie night' }),
    (error) => error.code === 'reward_not_approved',
  );

  const approval = await store.call('approve_reward_definition', {
    reward_id: proposal.reward_id,
    approver_name: 'Jamie',
  });
  assert.equal(approval.approved, true);
  assert.equal(byName((await store.getSnapshot()).rewards, 'Movie night').approved, true);

  const redemption = await store.call('redeem_reward', {
    approver_name: 'Jamie',
    user_name: 'Riley',
    reward_name: 'Movie night',
  });
  assert.equal(redemption.status, 'pending');
});

test('reward disapproval releases the reservation; manual grants can approve with a cost override', async (t) => {
  const { store } = await fixture(t);
  await addHousehold(store);
  await store.call('manual_adjust_points', { user_name: 'Riley', amount: 10, reason: 'Chore bonus' });
  await store.call('create_reward', { name: 'Ice cream', cost: 6 });
  const request = await store.call('redeem_reward', { approver_name: 'Jamie', user_name: 'Riley', reward_name: 'Ice cream' });
  const rejected = await store.call('disapprove_reward', { approver_name: 'Jamie', user_name: 'Riley', reward_name: 'Ice cream' });
  assert.equal(rejected.status, 'disapproved');
  assert.equal((await store.getSnapshot()).pending_approvals.rewards, 0);

  const manualGrant = await store.call('approve_reward', {
    approver_name: 'Jamie',
    user_name: 'Riley',
    reward_name: 'Ice cream',
    cost_override: 0,
  });
  assert.equal(manualGrant.cost, 0);
  assert.notEqual(manualGrant.claim_id, request.claim_id);
  assert.equal((await store.getSnapshot()).members.find((member) => member.name === 'Riley').points, 10);
});

test('manual point adjustments validate signed decimal values and ledger filters', async (t) => {
  const { store } = await fixture(t);
  await addHousehold(store);
  await store.call('manual_adjust_points', { user_name: 'Riley', amount: 2.25, reason: 'Helpful morning', approver_name: 'Jamie' });
  await store.call('manual_adjust_points', { user_name: 'Riley', amount: -0.25, reason: 'Correction' });
  await store.call('manual_adjust_points', { user_name: 'Jamie', amount: 4, reason: 'Parent adjustment' });
  await assert.rejects(
    store.call('manual_adjust_points', { user_name: 'Riley', amount: 0, reason: 'No-op' }),
    (error) => error.code === 'invalid_data',
  );
  await assert.rejects(
    store.call('manual_adjust_points', { user_name: 'Riley', amount: 1.001, reason: 'Too precise' }),
    (error) => error.code === 'invalid_data',
  );
  const oneUser = await store.call('get_ledger', { user_name: 'Riley', limit: 1 });
  assert.equal(oneUser.assignee_name, 'Riley');
  assert.equal(oneUser.count, 1);
  assert.equal(oneUser.truncated, true);
  const all = await store.call('get_ledger', {});
  assert.equal(all.count, 3);
  assert.equal(all.entries[0].name, 'Jamie');
});

test('rotation modes gate claims, advance turns, and support the ChoresMan controls', async (t) => {
  const { store, setNow } = await fixture(t);
  await addHousehold(store);
  await store.call('family.create_member', { name: 'Casey', role: 'child' });
  const chore = await store.call('create_chore', {
    name: 'Take turns', assigned_user_names: ['Riley', 'Casey'], points: 2,
    completion_criteria: 'rotation_simple', frequency: 'daily',
  });
  await assert.rejects(
    store.call('claim_chore', { user_name: 'Casey', chore_name: 'Take turns' }),
    (error) => error.code === 'not_my_turn',
  );
  await store.call('claim_chore', { user_name: 'Riley', chore_name: 'Take turns' });
  await store.call('approve_chore', { approver_name: 'Jamie', user_name: 'Riley', chore_name: 'Take turns' });
  assert.equal((await store.getSnapshot()).chores[0].current_turn_user_name, 'Casey');
  await store.call('set_rotation_turn', { chore_name: 'Take turns', user_name: 'Riley' });
  await store.call('open_rotation_cycle', { chore_id: chore.chore_id });
  setNow('2026-01-06T08:00:00Z');
  await store.call('claim_chore', { user_name: 'Casey', chore_name: 'Take turns' });
  await store.call('approve_chore', { approver_name: 'Jamie', user_name: 'Casey', chore_name: 'Take turns' });
  assert.equal((await store.getSnapshot()).chores[0].current_turn_user_name, 'Riley');
  await store.call('reset_rotation', { chore_id: chore.chore_id });

  await store.call('create_chore', {
    name: 'Daily slots', assigned_user_names: ['Riley'], frequency: 'daily_multi',
    daily_multi_times: ['08:00', '12:00', '18:00'], due_date: '2026-01-05T08:00:00Z', points: 1,
  });
  await store.call('claim_chore', { user_name: 'Riley', chore_name: 'Daily slots' });
  await store.call('approve_chore', { approver_name: 'Jamie', user_name: 'Riley', chore_name: 'Daily slots' });
  assert.equal(byName((await store.getSnapshot()).chores, 'Daily slots').due_date, '2026-01-05T12:00:00.000Z');
});

test('never-overdue rotation passes an unclaimed turn and suppresses overdue notifications', async (t) => {
  const { store, setNow } = await fixture(t);
  await addHousehold(store);
  await store.call('family.create_member', { name: 'Casey', role: 'child' });
  const chore = await store.call('create_chore', {
    name: 'Take a turn', assigned_user_names: ['Riley', 'Casey'], frequency: 'daily',
    due_date: '2026-01-05T08:00:00Z', completion_criteria: 'rotation_simple_from_turn_holder',
    overdue_handling: 'never_overdue',
  });
  await assert.rejects(
    store.call('create_chore', { name: 'Invalid never overdue', assigned_user_names: ['Riley'], overdue_handling: 'never_overdue' }),
    (error) => error.code === 'invalid_data',
  );

  setNow('2026-01-06T08:00:00Z');
  const maintenance = await store.call('run_scheduled_maintenance', {});
  const snapshot = await store.getSnapshot();
  assert.equal(maintenance.notifications_created, 0);
  assert.equal(snapshot.chores.find((entry) => entry.id === chore.chore_id).due_date, '2026-01-07T08:00:00.000Z');
  assert.equal(snapshot.chores.find((entry) => entry.id === chore.chore_id).current_turn_user_name, 'Casey');
  assert.ok((await store.getDocument()).chore_events.some((event) => event.type === 'rotation_advanced_at_boundary' && event.user_name === 'Riley'));
  assert.equal(snapshot.notifications.some((entry) => entry.type === 'chore_overdue'), false);
});

test('bonuses, penalties, badges, achievements, and challenges update persistent point history', async (t) => {
  const { store, setNow } = await fixture(t);
  await addHousehold(store);
  await store.call('create_bonus', { name: 'Helping out', points: 5 });
  await store.call('create_penalty', { name: 'Late task', points: 2 });
  await store.call('apply_bonus', { user_name: 'Riley', approver_name: 'Jamie', bonus_name: 'Helping out' });
  await store.call('apply_penalty', { user_name: 'Riley', approver_name: 'Jamie', penalty_name: 'Late task' });

  const badge = await store.call('create_badge', {
    name: 'Two chores', badge_type: 'periodic', assigned_user_names: ['Riley'],
    target_type: 'count', threshold_value: 2, frequency: 'weekly', reward_points: 3,
  });
  await store.call('create_achievement', {
    name: 'Steady helper', assigned_user_names: ['Riley'], criteria: 'completions',
    target_value: 2, reward_points: 4,
  });
  await store.call('create_challenge', {
    name: 'January sprint', assigned_user_names: ['Riley'], criteria: 'count', target_value: 2,
    reward_points: 6, start_date: '2026-01-05T00:00:00Z', end_date: '2026-01-10T00:00:00Z',
  });
  await store.call('create_chore', { name: 'Read', assigned_user_names: ['Riley'], points: 1, frequency: 'daily' });
  await store.call('claim_chore', { user_name: 'Riley', chore_name: 'Read' });
  await store.call('approve_chore', { approver_name: 'Jamie', user_name: 'Riley', chore_name: 'Read' });
  setNow('2026-01-06T08:00:00Z');
  await store.call('claim_chore', { user_name: 'Riley', chore_name: 'Read' });
  await store.call('approve_chore', { approver_name: 'Jamie', user_name: 'Riley', chore_name: 'Read' });

  await store.call('create_badge', { name: 'Birthday star', badge_type: 'special', assigned_user_names: ['Riley'] });
  const manualAward = await store.call('award_badge', { badge_name: 'Birthday star', user_name: 'Riley', approver_name: 'Jamie' });
  assert.equal(manualAward.awarded, true);
  const snapshot = await store.getSnapshot();
  assert.equal(snapshot.badge_awards.filter((award) => award.badge_id === badge.badge_id).length, 1);
  assert.equal(snapshot.goal_progress.filter((entry) => entry.completed).length, 2);
  assert.equal(snapshot.members.find((member) => member.name === 'Riley').points, 18);
  assert.ok(snapshot.notifications.some((entry) => entry.type === 'badge_awarded'));
  const removed = await store.call('remove_awarded_badges', { user_name: 'Riley', badge_name: 'Birthday star' });
  assert.equal(removed.removed_count, 1);
});

test('badge streaks retain recent history and can be repaired with the ChoresMan action', async (t) => {
  const { store, setNow } = await fixture(t);
  await addHousehold(store);
  const badge = await store.call('create_badge', {
    name: 'Three day streak', badge_type: 'periodic', assigned_user_names: ['Riley'],
    target_type: 'streak', threshold_value: 3, frequency: 'weekly',
  });
  await store.call('create_chore', { name: 'Read a page', assigned_user_names: ['Riley'], frequency: 'daily' });

  for (const date of ['2026-01-05', '2026-01-06', '2026-01-07']) {
    setNow(`${date}T08:00:00Z`);
    await store.call('claim_chore', { user_name: 'Riley', chore_name: 'Read a page' });
    await store.call('approve_chore', { approver_name: 'Jamie', user_name: 'Riley', chore_name: 'Read a page' });
  }
  const repaired = await store.call('repair_badge_streak', {
    badge_id: badge.badge_id, user_name: 'Riley', approver_name: 'Jamie', reason: 'Verified completed chores',
  });
  const document = await store.getDocument();
  const progress = document.badge_progress.find((entry) => entry.goal_id === badge.badge_id);
  assert.equal(repaired.badge_streak_count, 3);
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.award_id, null);
  assert.deepEqual(progress.streak_history.map((entry) => entry.date), ['2026-01-05', '2026-01-06', '2026-01-07']);
  assert.equal(progress.streak, 3);
  assert.equal(progress.last_date, '2026-01-06');
  assert.ok(document.chore_events.some((event) => event.type === 'badge_streak_repaired' && event.reason === 'Verified completed chores'));

  await store.call('create_badge', {
    name: 'Five good days', badge_type: 'periodic', assigned_user_names: ['Riley'],
    target_type: 'streak', threshold_value: 5, frequency: 'weekly',
  });
  const explicit = await store.call('repair_badge_streak', {
    badge_name: 'Five good days', user_name: 'Riley', badge_streak_count: 5,
  });
  assert.equal(explicit.badge_streak_count, 5);
  assert.ok(explicit.award_id);
  await assert.rejects(
    store.call('repair_badge_streak', { badge_name: 'Five good days', user_name: 'Riley', badge_streak_count: 1.5 }),
    (error) => error.code === 'invalid_data',
  );
  await store.call('create_badge', {
    name: 'No missing work', badge_type: 'periodic', assigned_user_names: ['Riley'],
    target_type: 'no_overdue', threshold_value: 5, frequency: 'weekly',
  });
  await assert.rejects(
    store.call('repair_badge_streak', { badge_name: 'No missing work', user_name: 'Riley', badge_streak_count: 2 }),
    (error) => error.code === 'streak_repair_unsupported',
  );
});

test('rescheduling, due notifications, reports, UI controls, and explicit resets work', async (t) => {
  const { store, setNow } = await fixture(t);
  await addHousehold(store);
  const chore = await store.call('create_chore', {
    name: 'Clean desk', assigned_user_names: ['Riley'], frequency: 'weekly',
    due_date: '2026-01-05T09:00:00Z', due_window_offset: '1h', due_reminder_offset: '15m',
    notify_on_due_window: true, notification_channel: 'local-test', notification_importance: 'high',
    notification_priority: 'high', notification_ttl: 3600,
  });
  const moved = await store.call('reschedule_chores_after', {
    after: '2026-01-20T09:00:00Z', chore_ids: [chore.chore_id], reschedule_independent: true,
  });
  assert.equal(moved.updated_count, 1);
  assert.equal((await store.getSnapshot()).chores[0].due_date_by_member[(await store.getSnapshot()).members.find((member) => member.name === 'Riley').id], '2026-01-27T09:00:00.000Z');

  await store.call('set_chore_due_date', { chore_id: chore.chore_id, due_date: '2026-01-05T09:00:00Z' });
  const firstScan = await store.call('run_scheduled_maintenance', {});
  assert.equal(firstScan.notifications_created, 1);
  const queued = (await store.call('get_notifications', { user_name: 'Riley' })).find((entry) => entry.type === 'chore_due_window');
  assert.equal(queued.channel, 'local-test');
  assert.equal(queued.importance, 'high');
  assert.equal(queued.priority, 'high');
  assert.equal(queued.ttl, 3600);
  assert.equal((await store.call('run_scheduled_maintenance', {})).notifications_created, 0);
  setNow('2026-01-05T08:50:00Z');
  await store.call('run_scheduled_maintenance', {});
  assert.ok((await store.call('get_notifications', { user_name: 'Riley' })).some((entry) => entry.type === 'chore_due_reminder'));
  setNow('2026-01-05T09:01:00Z');
  await store.call('run_scheduled_maintenance', {});
  assert.ok((await store.call('get_notifications', { user_name: 'Riley' })).some((entry) => entry.type === 'chore_overdue'));

  await store.call('manage_ui_control', { user_name: 'Riley', ui_control_action: 'create', key: 'gamification/rewards/collapsed', value: true });
  await store.call('manage_ui_control', { user_name: 'Riley', ui_control_action: 'update', key: 'gamification/rewards/collapsed', value: false });
  assert.equal((await store.getSnapshot()).ui_controls[0].values.gamification.rewards.collapsed, false);
  const report = await store.call('generate_activity_report', { user_name: 'Riley', output_format: 'both', notify_service: 'local' });
  assert.ok(report.markdown.includes('Family Activity Report'));
  assert.ok(report.html.includes('<article>'));
  assert.ok((await store.call('get_notifications', { user_name: 'Riley' })).some((entry) => entry.type === 'activity_report' && entry.channel === 'local'));

  await assert.rejects(
    store.call('reset_transactional_data', { scope: 'user', user_name: 'Riley', item_type: 'points' }),
    (error) => error.code === 'confirmation_required',
  );
  await store.call('reset_transactional_data', { confirm_destructive: true, scope: 'user', user_name: 'Riley', item_type: 'points' });
  assert.equal((await store.getSnapshot()).members.find((member) => member.name === 'Riley').points, 0);
  await store.call('manage_ui_control', { user_name: 'Riley', ui_control_action: 'remove', key: 'gamification/rewards/collapsed' });
  assert.deepEqual((await store.getSnapshot()).ui_controls[0].values, { gamification: { rewards: {} } });
});

test('reset_all_data requires confirmation, clears all ChoresMan collections, and keeps family profiles', async (t) => {
  const { store } = await fixture(t);
  const { parent, child } = await addHousehold(store);
  await store._mutate((document) => {
    for (const key of [
      'chores', 'chore_claims', 'chore_events', 'rewards', 'reward_claims', 'ledger',
      'bonuses', 'penalties', 'badges', 'badge_awards', 'badge_progress', 'achievements',
      'challenges', 'goal_progress', 'notifications', 'ui_controls',
    ]) {
      document[key] = [{ id: key, member_id: child.id, amount: 25 }];
    }
    return { seeded: true };
  });

  await assert.rejects(
    store.call('reset_all_data', {}),
    (error) => error.code === 'confirmation_required',
  );
  const result = await store.call('reset_all_data', { confirm_destructive: true });
  const document = await store.getDocument();
  const snapshot = await store.getSnapshot();

  assert.equal(result.reset, true);
  assert.equal(result.preserved_family_profiles, 2);
  assert.equal(result.removed.chores, 1);
  for (const key of [
    'chores', 'chore_claims', 'chore_events', 'rewards', 'reward_claims', 'ledger',
    'bonuses', 'penalties', 'badges', 'badge_awards', 'badge_progress', 'achievements',
    'challenges', 'goal_progress', 'notifications', 'ui_controls',
  ]) {
    assert.deepEqual(document[key], [], `${key} should be empty after reset`);
  }
  assert.deepEqual(snapshot.members.map(({ id, name, role }) => ({ id, name, role })), [
    { id: parent.id, name: 'Jamie', role: 'parent' },
    { id: child.id, name: 'Riley', role: 'child' },
  ]);
  assert.equal(snapshot.members.find((member) => member.id === child.id).points, 0);
});

test('overdue reset, pending reset, notification delivery acknowledgement, and schema migration work', async (t) => {
  const { store, dataDir, setNow } = await fixture(t);
  await addHousehold(store);
  const chore = await store.call('create_chore', {
    name: 'Old task', assigned_user_names: ['Riley'], frequency: 'weekly', due_date: '2026-01-05T08:00:00Z',
  });
  await store.call('claim_chore', { user_name: 'Riley', chore_name: 'Old task' });
  await store.call('reset_chores_to_pending_state', {});
  assert.equal((await store.getSnapshot()).chore_claims[0].status, 'reset');
  setNow('2026-01-20T08:00:00Z');
  const reset = await store.call('reset_overdue_chores', { chore_id: chore.chore_id, user_name: 'Riley' });
  assert.equal(reset.updated_count, 1);
  assert.equal((await store.getSnapshot()).chores[0].due_date_by_member[(await store.getSnapshot()).members.find((member) => member.name === 'Riley').id], '2026-01-26T08:00:00.000Z');
  const notification = await store.call('get_notifications', { user_name: 'Jamie' });
  if (notification[0]) {
    const acknowledged = await store.call('acknowledge_notification', { notification_id: notification[0].id });
    assert.equal(acknowledged.status, 'delivered');
  }

  const v1 = {
    schema_version: 1, updated_at: null, members: [], chores: [], chore_claims: [],
    chore_events: [], rewards: [], reward_claims: [], ledger: [],
  };
  const filePath = path.join(dataDir, 'legacy.json');
  await fs.writeFile(filePath, JSON.stringify(v1), 'utf8');
  const legacyStore = new ChoresManStore({ filePath });
  assert.equal((await legacyStore.getDocument()).schema_version, 2);
  await legacyStore.call('family.create_member', { name: 'Morgan' });
  assert.equal(JSON.parse(await fs.readFile(filePath, 'utf8')).schema_version, 2);
});

test('JSON persistence survives restart and concurrent writes are serialized', async (t) => {
  const { store, dataDir } = await fixture(t);
  const secondWriter = new ChoresManStore({ dataDir });
  await Promise.all([
    store.call('family.create_member', { name: 'Jamie', role: 'parent' }),
    secondWriter.call('family.create_member', { name: 'Riley', role: 'child' }),
    store.call('family.create_member', { name: 'Casey', role: 'child' }),
  ]);
  const filePath = path.join(dataDir, 'choresman.json');
  const raw = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(raw.schema_version, 2);
  assert.equal(raw.members.length, 3);

  const restarted = new ChoresManStore({ filePath });
  assert.deepEqual(
    (await restarted.getSnapshot()).members.map((member) => member.name).sort(),
    ['Casey', 'Jamie', 'Riley'],
  );
  const stat = await fs.stat(filePath);
  assert.equal(stat.mode & 0o077, 0);
});

test('invalid JSON is reported without replacing the existing file', async (t) => {
  const { store, dataDir } = await fixture(t);
  const filePath = path.join(dataDir, 'choresman.json');
  await fs.writeFile(filePath, '{broken json', 'utf8');
  await assert.rejects(
    store.getSnapshot(),
    (error) => error.code === 'storage_corrupt',
  );
  assert.equal(await fs.readFile(filePath, 'utf8'), '{broken json');
});
