import { test, expect, type Page } from '@playwright/test';
import { startStack, putData, getData, type E2EStack } from './stack';

/**
 * Reward lifecycle, end to end:
 *
 *   child proposes a reward ──parent PIN──▶ available
 *   child splits points across goals, keeping some spendable
 *   goal reaches its cost ──▶ locked, waiting for a parent
 *   parent approves payout ──▶ ChoreOps approves once, then "use again / delete"
 *   use again ──▶ same reward back at 0 allocations
 *   delete    ──▶ reward gone from ChoreOps, history kept
 *
 * The test runs against the real backend and a fake Home Assistant, so the
 * planner reducer, persistence and the ChoreOps service bridge are all real.
 */

const FAMILY = [
  {
    id: 'parent-1',
    name: 'Papa',
    avatar: '\u{1F9D1}',
    color: '#1f7a5a',
    role: 'parent',
    pin: '1234',
  },
  {
    id: 'child-1',
    name: 'Zara',
    avatar: '\u{1F9D2}',
    color: '#cf6d55',
    role: 'child',
    choreops_user: 'Zara',
  },
];

let stack: E2EStack;

test.beforeAll(async () => {
  stack = await startStack();
  stack.fakeHa.reset({ users: [{ name: 'Zara', points: 10 }] });
  await putData(stack.appUrl, 'beacon_family_members', FAMILY);
});

test.afterAll(async () => {
  await stack.close();
});

function sheetWithHeading(page: Page, name: string) {
  return page
    .locator('.planner-sheet')
    .filter({ has: page.getByRole('heading', { name, exact: false }) });
}

function goalsSheet(page: Page) {
  return sheetWithHeading(page, 'Goals');
}

function zaraColumn(page: Page) {
  return page
    .locator('.planner-col')
    .filter({ has: page.locator('.planner-col-head strong', { hasText: 'Zara' }) });
}

async function gotoChores(page: Page) {
  await page
    .locator('.sidebar--desktop')
    .getByRole('button', { name: 'Chores', exact: true })
    .click();
  await expect(page.locator('.planner-board')).toBeVisible();
  await expect(zaraColumn(page)).toBeVisible();
}

async function openGoals(page: Page) {
  // Idempotent: creating several rewards in a row leaves the sheet open.
  if (
    await goalsSheet(page)
      .isVisible()
      .catch(() => false)
  )
    return;
  await zaraColumn(page).getByRole('button', { name: 'Goals: Zara' }).click();
  await expect(goalsSheet(page)).toBeVisible();
}

async function unlockPin(page: Page) {
  const pin = page.locator('.planner-pin-input');
  await expect(pin).toBeVisible();
  await pin.fill('1234');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
}

async function createReward(page: Page, name: string, cost: number) {
  await openGoals(page);
  await goalsSheet(page).getByRole('button', { name: 'Set a goal' }).click();
  const form = sheetWithHeading(page, 'Add reward');
  await form.getByRole('textbox').fill(name);
  await form.locator('input[type="number"]').fill(String(cost));
  // The child whose goals sheet was opened is preselected; adding another
  // child is a toggle, so the test leaves the prefilled selection alone.
  await form.getByRole('button', { name: 'Save', exact: true }).click();

  // Creating a reward is a parent decision: the PIN sheet must appear.
  await unlockPin(page);
  await expect(page.locator('.planner-sheet')).toHaveCount(0);
  await openGoals(page);
  await expect(goalsSheet(page).locator('.planner-reward').filter({ hasText: name })).toBeVisible();
}

function rewardRow(page: Page, name: string) {
  return goalsSheet(page).locator('.planner-reward').filter({ hasText: name }).first();
}

async function assignPoints(page: Page, name: string, amount: number) {
  await rewardRow(page, name).getByRole('button', { name: 'Assign', exact: true }).click();
  const assign = sheetWithHeading(page, 'Distribute points');
  await expect(assign).toBeVisible();
  await assign.getByRole('spinbutton').fill(String(amount));
  await assign.getByRole('button', { name: 'Assign', exact: true }).click();
  await expect(assign).toHaveCount(0);
  await expect(goalsSheet(page)).toBeVisible();
}

async function approvePayout(page: Page, name: string) {
  await rewardRow(page, name).getByRole('button', { name: 'Approve reward', exact: true }).click();
  await unlockPin(page);
  await expect(sheetWithHeading(page, 'Reward given')).toBeVisible();
}

test('child splits points, parent approves payout, then reuse or delete', async ({ page }) => {
  await page.addInitScript((members) => {
    localStorage.setItem('beacon_family_members', JSON.stringify(members));
  }, FAMILY);

  await page.goto(stack.appUrl);
  await gotoChores(page);
  await expect(zaraColumn(page).locator('.planner-col-points')).toContainText('10');

  // 1. The child proposes both goals; each creation needs a parent PIN.
  await createReward(page, 'Film night', 7);
  await createReward(page, 'Snack', 8);
  expect(stack.fakeHa.serviceCalls('choreops.create_reward')).toHaveLength(2);

  // 2. 10 points split as 5 + 3, with 2 still in the savings pot.
  await assignPoints(page, 'Film night', 5);
  await expect(rewardRow(page, 'Film night')).toContainText('5 / 7');
  await assignPoints(page, 'Snack', 3);
  await expect(rewardRow(page, 'Snack')).toContainText('3 / 8');
  await expect(zaraColumn(page).locator('.planner-col-points')).toHaveText(/2/);

  // 3. The last 2 points complete Film night; it locks until fulfilment.
  await assignPoints(page, 'Film night', 2);
  const film = rewardRow(page, 'Film night');
  await expect(film).toContainText('7 / 7');
  await expect(film).toContainText('Waiting for reward');
  await expect(film.getByRole('button', { name: 'Assign', exact: true })).toHaveCount(0);
  await expect(rewardRow(page, 'Snack')).toContainText('3 / 8');

  // 4. A parent approves the payout: ChoreOps is called exactly once.
  await approvePayout(page, 'Film night');
  expect(stack.fakeHa.serviceCalls('choreops.approve_reward')).toHaveLength(1);
  expect(stack.fakeHa.serviceCalls('choreops.approve_reward')[0].data).toMatchObject({
    user_name: 'Zara',
    reward_name: 'Film night',
  });
  // ChoreOps deducted the cost (10 - 7), and the reward is back on offer.
  expect(stack.fakeHa.points('Zara')).toBe(3);

  // 5. "Use again" puts the same reward back at zero allocations.
  await sheetWithHeading(page, 'Reward given').getByRole('button', { name: 'Use again' }).click();
  await expect(goalsSheet(page)).toBeVisible();
  await expect(rewardRow(page, 'Film night')).toContainText('0 / 7');
  // Snack is still untouched and still holds its 3 points.
  await expect(rewardRow(page, 'Snack')).toContainText('3 / 8');

  // 6. Give the child more points, then complete Snack and delete it after payout.
  stack.fakeHa.setPoints('Zara', 8); // 3 still committed to Snack → 5 spendable
  await page.reload();
  await gotoChores(page);
  await openGoals(page);
  await assignPoints(page, 'Snack', 5);
  await expect(rewardRow(page, 'Snack')).toContainText('8 / 8');

  await approvePayout(page, 'Snack');
  await sheetWithHeading(page, 'Reward given').getByRole('button', { name: 'Delete' }).click();

  // The definition is gone from ChoreOps, so it disappears from the goals.
  await expect.poll(() => stack.fakeHa.serviceCalls('choreops.delete_reward').length).toBe(1);
  expect(stack.fakeHa.rewardNames()).not.toContain('Snack');
  await openGoals(page);
  // The goal is gone; the "given rewards" history intentionally keeps its name.
  await expect(
    goalsSheet(page)
      .locator('.planner-reward')
      .filter({ hasText: 'Snack' })
      .filter({ has: page.locator('i > b') }),
  ).toHaveCount(0);
  await expect(rewardRow(page, 'Film night')).toBeVisible();

  // 7. Both payouts are kept as history, and no pursuit is left active.
  const redemptions = await getData<Array<{ reward: string; state: string }>>(
    stack.appUrl,
    'beacon-reward-redemptions',
  );
  const byReward = new Map(
    (redemptions ?? []).map((redemption) => [redemption.reward, redemption.state]),
  );
  expect(byReward.get('film night')).toBe('fulfilled');
  expect(byReward.get('snack')).toBe('fulfilled');
});
