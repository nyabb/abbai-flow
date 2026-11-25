import { describe, it, expect } from 'vitest';
import { buildUpdateChorePayload, formatChoresManOffset } from './chore-model';

describe('formatChoresManOffset', () => {
  it('normalizes expanded ChoresMan offset strings', () => {
    expect(formatChoresManOffset('0d 1h 0m')).toBe('1h');
    expect(formatChoresManOffset('1d 0h 0m')).toBe('1d');
    expect(formatChoresManOffset('0d 0h 30m')).toBe('30m');
    expect(formatChoresManOffset('1d 6h 15m')).toBe('1d 6h 15m');
  });

  it('returns an empty string for a zero or missing offset', () => {
    expect(formatChoresManOffset('0d 0h 0m')).toBe('');
    expect(formatChoresManOffset(null)).toBe('');
    expect(formatChoresManOffset(undefined)).toBe('');
  });
});

describe('buildUpdateChorePayload', () => {
  it('requires a chore name and a matching lookup name when there is no id', () => {
    expect(buildUpdateChorePayload({ name: '   ' })).toBeNull();
    expect(buildUpdateChorePayload({ name: 'Nieuwe naam', targetName: 'Oude naam' })).toBeNull();
  });

  it('only sends the fields that changed', () => {
    const payload = buildUpdateChorePayload({ name: ' Afwassen ', points: 7.4 });

    expect(payload).toEqual({ name: 'Afwassen', points: 7 });
  });

  it('replaces the assignee list explicitly', () => {
    const payload = buildUpdateChorePayload({
      name: 'Afwassen',
      assignedUserNames: ['Maya', ' Maya ', 'Nova'],
    });

    expect(payload).toMatchObject({
      assignment_action: 'replace',
      assigned_user_names: ['Maya', 'Nova'],
    });
  });

  it('sends the stable chore ID, new name, and all-users sentinel', () => {
    const payload = buildUpdateChorePayload({
      choreId: '023e4567-e89b-12d3-a456-426614174000',
      name: 'Tafel dekken',
      assignedUserNames: ['*'],
    });

    expect(payload).toEqual({
      id: '023e4567-e89b-12d3-a456-426614174000',
      name: 'Tafel dekken',
      assignment_action: 'replace',
      assigned_user_names: ['*'],
    });
    // ChoresMan resolves this sentinel to all current family members.
  });

  it('does not send the create-only completion rule on updates', () => {
    const payload = buildUpdateChorePayload({
      name: 'Afwassen',
      assignedUserNames: ['Maya'],
    });

    expect(payload).not.toHaveProperty('completion_criteria');
  });

  it('sends schedule fields together with the due date ChoresMan requires', () => {
    const payload = buildUpdateChorePayload({
      name: 'Stofzuigen',
      frequency: 'weekly',
      applicableDays: ['mon', 'thu', 'nope'],
      dueDate: '2026-11-07T17:00:00.000Z',
      windowOffset: '2h',
      autoApprove: true,
      description: ' De gang ',
    });

    expect(payload).toMatchObject({
      frequency: 'weekly',
      applicable_days: ['mon', 'thu'],
      due_date: '2026-11-07T17:00:00.000Z',
      due_window_offset: '2h',
      auto_approve: true,
      description: 'De gang',
    });
  });

  it('preserves calendar visibility and notification delivery options', () => {
    const payload = buildUpdateChorePayload({
      name: 'Afwassen',
      notificationChannel: 'mobile_app',
      notificationImportance: 'high',
      notificationPriority: 'high',
      notificationTtl: 3600,
      showOnCalendar: false,
    });
    expect(payload).toMatchObject({
      notification_channel: 'mobile_app',
      notification_importance: 'high',
      notification_priority: 'high',
      notification_ttl: 3600,
      show_on_calendar: false,
    });
  });

  it('clears the due window with 0 and omits an untouched reminder', () => {
    const cleared = buildUpdateChorePayload({ name: 'Afwassen', windowOffset: '' });
    expect(cleared).toMatchObject({ due_window_offset: '0' });
    expect(cleared).not.toHaveProperty('due_reminder_offset');

    const withReminder = buildUpdateChorePayload({
      name: 'Afwassen',
      reminderOffset: ' 30m ',
    });
    expect(withReminder).toMatchObject({ due_reminder_offset: '30m' });
  });

  it('can clear weekly applicable days with the native update service', () => {
    expect(
      buildUpdateChorePayload({
        name: 'Afwassen',
        applicableDays: [],
      }),
    ).toMatchObject({ applicable_days: [] });
  });

  it('sends the custom interval only for custom repeats', () => {
    const custom = buildUpdateChorePayload({
      name: 'Planten',
      frequency: 'custom',
      customInterval: 3,
      customIntervalUnit: 'weeks',
    });
    expect(custom).toMatchObject({ custom_interval: 3, custom_interval_unit: 'weeks' });

    const daily = buildUpdateChorePayload({
      name: 'Planten',
      frequency: 'daily',
      customInterval: 3,
    });
    expect(daily).not.toHaveProperty('custom_interval');
  });
});
