import { test, expect, type Page } from '@playwright/test';
import {
  callChoresMan,
  loadChoresMan,
  startStack,
  putData,
  type E2EStack,
} from './stack';

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
  },
  {
    id: 'child-2',
    name: 'Maya',
    avatar: '\u{1F467}',
    color: '#6688cc',
    role: 'child',
  },
];

let stack: E2EStack;

test.beforeAll(async () => {
  stack = await startStack();
  await callChoresMan(stack.appUrl, 'family.sync_members', { members: FAMILY });
  await callChoresMan(stack.appUrl, 'create_chore', {
    name: 'Sweep the kitchen',
    assigned_user_names: ['Zara', 'Maya'],
    completion_criteria: 'shared_first',
    points: 3,
  });
  await putData(stack.appUrl, 'abbai_flow_family_members', FAMILY);
});

test.afterAll(async () => {
  await stack.close();
});

function childColumn(page: Page, name: string) {
  return page
    .locator('.planner-col')
    .filter({ has: page.locator('.planner-col-head strong', { hasText: name }) });
}

test('moves a free shared chore to both children through ChoresMan create', async ({ page }) => {
  await page.addInitScript((members) => {
    localStorage.setItem('abbai_flow_family_members', JSON.stringify(members));
  }, FAMILY);

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

  await expect
    .poll(async () => {
      const snapshot = await loadChoresMan(stack.appUrl);
      return snapshot.chores.map(({ name, assigned_user_names, completion_criteria }) => ({
        name,
        assigned_user_names: [...assigned_user_names].sort(),
        completion_criteria,
      }));
    })
    .toEqual([
      {
        name: 'Sweep the kitchen',
        assigned_user_names: ['Maya', 'Zara'],
        completion_criteria: 'independent',
      },
    ]);

  await expect(childColumn(page, 'Zara').locator('.planner-row').filter({ hasText: 'Sweep the kitchen' })).toBeVisible();
  await expect(childColumn(page, 'Maya').locator('.planner-row').filter({ hasText: 'Sweep the kitchen' })).toBeVisible();
  await expect(page.locator('.planner-col--free .planner-row').filter({ hasText: 'Sweep the kitchen' })).toHaveCount(0);
});
