import { test, expect, type Page } from '@playwright/test';
import { startStack, putData, type E2EStack } from './stack';

const CHORE_ID = '01234567-89ab-cdef-0123-456789abcdef';
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
  {
    id: 'child-2',
    name: 'Maya',
    avatar: '\u{1F467}',
    color: '#6688cc',
    role: 'child',
    choreops_user: 'Maya',
  },
];

let stack: E2EStack;

test.beforeAll(async () => {
  stack = await startStack();
  stack.fakeHa.reset({
    users: [
      { name: 'Zara', points: 10 },
      { name: 'Maya', points: 10 },
    ],
    chores: [
      {
        user: 'Zara',
        assignedUsers: ['Zara', 'Maya'],
        id: CHORE_ID,
        completionCriteria: 'shared_first',
        name: 'Sweep the kitchen',
        points: 3,
      },
    ],
  });
  await putData(stack.appUrl, 'beacon_family_members', FAMILY);
});

test.afterAll(async () => {
  await stack.close();
});

function childColumn(page: Page, name: string) {
  return page
    .locator('.planner-col')
    .filter({ has: page.locator('.planner-col-head strong', { hasText: name }) });
}

test('moves a free shared chore to both children through ChoreOps create', async ({ page }) => {
  await page.addInitScript((members) => {
    localStorage.setItem('beacon_family_members', JSON.stringify(members));
  }, FAMILY);

  await page.route('**/beacon-action/entity-registry', async (route) => {
    const { entity_id: entityId } = route.request().postDataJSON() as { entity_id: string };
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        entry: {
          entity_id: entityId,
          platform: 'choreops',
          unique_id: `entry-e2e_11111111-1111-1111-1111-111111111111_${CHORE_ID}_status`,
        },
      }),
    });
  });

  await page.goto(stack.appUrl);
  await page
    .locator('.sidebar--desktop')
    .getByRole('button', { name: 'Chores', exact: true })
    .click();

  const freeRow = page
    .locator('.planner-col--free .planner-row')
    .filter({ hasText: 'Sweep the kitchen' });
  await expect(freeRow).toBeVisible();
  await freeRow.locator('.planner-row-more').click();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();

  await page.locator('.planner-pin-input').fill('1234');
  await page.getByRole('button', { name: 'Unlock', exact: true }).click();
  const form = page.locator('.planner-sheet');
  await expect(form.locator('.planner-member-picker')).toBeVisible();
  await form.getByRole('button', { name: 'Everyone', exact: true }).click();
  await form.getByRole('button', { name: 'Save', exact: true }).click();

  await expect.poll(() => stack.fakeHa.serviceCalls('choreops.create_chore').length).toBe(1);
  const renameCall = stack.fakeHa.serviceCalls('choreops.update_chore')[0];
  const createCall = stack.fakeHa.serviceCalls('choreops.create_chore')[0];
  const deleteCall = stack.fakeHa.serviceCalls('choreops.delete_chore')[0];

  expect(renameCall.data).toMatchObject({
    config_entry_id: 'entry-e2e',
    id: CHORE_ID,
  });
  expect(renameCall.data.name).toMatch(/^__abbai_flow_recreate_/);
  expect(createCall.data).toMatchObject({
    config_entry_id: 'entry-e2e',
    name: 'Sweep the kitchen',
    assigned_user_names: ['Maya', 'Zara'],
    completion_criteria: 'independent',
  });
  expect(deleteCall.data.name).toBe(renameCall.data.name);

  await expect(childColumn(page, 'Zara').locator('.planner-row').filter({ hasText: 'Sweep the kitchen' })).toBeVisible();
  await expect(childColumn(page, 'Maya').locator('.planner-row').filter({ hasText: 'Sweep the kitchen' })).toBeVisible();
  await expect(page.locator('.planner-col--free .planner-row').filter({ hasText: 'Sweep the kitchen' })).toHaveCount(0);
});
