import { test, expect, type Page } from '@playwright/test';
import { startStack, putData, getData, type E2EStack } from './stack';

const FAMILY = [
  {
    id: 'parent-1',
    name: 'Papa',
    avatar: '\u{1F9D1}',
    color: '#1f7a5a',
    role: 'parent',
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
  stack.fakeHa.reset({ users: [{ name: 'Zara', points: 10 }], chores: [] });
  await putData(stack.appUrl, 'abbai_flow_family_members', FAMILY);
  await putData(stack.appUrl, 'abbai_flow_routines', []);
  await putData(stack.appUrl, 'abbai_flow_routine_completions', []);
});

test.afterAll(async () => {
  await stack?.close();
});

async function openFamilySettings(page: Page) {
  await page
    .locator('.sidebar--desktop')
    .getByRole('button', { name: 'Settings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Family Members', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Family Members', exact: true })).toBeVisible();
}

async function openMemberRoutines(page: Page, name: string) {
  await page.getByRole('button', { name: `Routines for ${name}`, exact: true }).click();
  await expect(page.getByRole('heading', { name: `${name} — Routines` })).toBeVisible();
}

async function createRoutine(page: Page, name: string, task: string, selectedDays?: string[]) {
  await page.getByRole('button', { name: /Add Routine/ }).click();
  const form = page.locator('.settings-group');
  await form.locator('input.settings-input').first().fill(name);
  await form.getByPlaceholder('Task 1 (e.g. Brush teeth)').fill(task);

  if (selectedDays) {
    const weekdays = page.getByRole('group', { name: 'Repeat on' });
    for (const day of [
      'Sunday',
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ]) {
      if (!selectedDays.includes(day)) {
        await weekdays.getByRole('button', { name: day, exact: true }).click();
      }
    }
  }

  await page.getByRole('button', { name: 'Save Routine', exact: true }).click();
}

test('creates Abbai Flow routines for kids and parents through shared entry points', async ({
  page,
}) => {
  await page.addInitScript((members) => {
    localStorage.setItem('abbai_flow_family_members', JSON.stringify(members));
    localStorage.setItem('abbai_flow_routines', '[]');
  }, FAMILY);
  await page.goto(stack.appUrl);

  // Settings is the canonical editor. A selected-weekday routine is persisted
  // as Abbai Flow data and has no ChoreOps side effect.
  await openFamilySettings(page);
  await openMemberRoutines(page, 'Zara');
  await createRoutine(page, 'School mornings', 'Brush teeth', ['Monday', 'Wednesday']);

  await expect
    .poll(async () => getData<Array<Record<string, unknown>>>(stack.appUrl, 'abbai_flow_routines'))
    .toMatchObject([
      {
        name: 'School mornings',
        member_id: 'child-1',
        days_of_week: [1, 3],
        tasks: [expect.objectContaining({ name: 'Brush teeth' })],
      },
    ]);
  expect(stack.fakeHa.serviceCalls('choreops.create_chore')).toHaveLength(0);

  // Parents can make the same routines, without a points field or mission.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await openMemberRoutines(page, 'Papa');
  await expect(page.getByText('Mission points')).toHaveCount(0);
  await createRoutine(page, 'Kitchen reset', 'Clear the counter');

  await expect
    .poll(async () => getData<Array<Record<string, unknown>>>(stack.appUrl, 'abbai_flow_routines'))
    .toMatchObject([
      expect.objectContaining({ name: 'School mornings', days_of_week: [1, 3] }),
      expect.objectContaining({
        name: 'Kitchen reset',
        member_id: 'parent-1',
        mission_points: 0,
        tasks: [expect.objectContaining({ name: 'Clear the counter' })],
      }),
    ]);

  await page.locator('.sidebar--desktop').getByRole('button', { name: 'Chores' }).click();
  const papa = page
    .locator('.planner-col')
    .filter({ has: page.locator('.planner-col-head strong', { hasText: 'Papa' }) });
  await expect(
    papa.locator('.planner-row--routine').filter({ hasText: 'Kitchen reset' }),
  ).toBeVisible();
  await expect(papa.getByText('Clear the counter')).toBeVisible();
  await expect(papa.locator('.planner-col-points')).toHaveCount(0);
  await expect(papa.locator('.planner-col-play')).toHaveCount(0);
  await expect(papa.locator('.planner-row-start')).toHaveCount(0);

  // The Omni Add routine shortcut opens the same Family editor.
  await page
    .locator('.sidebar--desktop')
    .getByRole('button', { name: 'Quick add', exact: true })
    .click();
  await page.getByRole('button', { name: 'Routine', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Family Members', exact: true })).toBeVisible();

  // Chores page quick add reaches that same editor, without creating a chore.
  await page.locator('.sidebar--desktop').getByRole('button', { name: 'Chores' }).click();
  await page.locator('.planner-add').click();
  await page.getByRole('button', { name: 'New routine', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Family Members', exact: true })).toBeVisible();
  expect(stack.fakeHa.serviceCalls('choreops.create_chore')).toHaveLength(0);
});
