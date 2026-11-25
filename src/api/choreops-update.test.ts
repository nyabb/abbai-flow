import { describe, it, expect } from 'vitest';
import { buildUpdateChorePayload, formatChoreOpsOffset } from './choreops';

describe('formatChoreOpsOffset', () => {
  it('turns the sensor format into the service format', () => {
    expect(formatChoreOpsOffset('0d 1h 0m')).toBe('1h');
    expect(formatChoreOpsOffset('1d 0h 0m')).toBe('1d');
    expect(formatChoreOpsOffset('0d 0h 30m')).toBe('30m');
    expect(formatChoreOpsOffset('1d 6h 15m')).toBe('1d 6h 15m');
  });

  it('returns an empty string for a zero or missing offset', () => {
    expect(formatChoreOpsOffset('0d 0h 0m')).toBe('');
    expect(formatChoreOpsOffset(null)).toBe('');
    expect(formatChoreOpsOffset(undefined)).toBe('');
  });
});

describe('buildUpdateChorePayload', () => {
  it('requires a config entry and the chore name ChoreOps resolves by', () => {
    expect(buildUpdateChorePayload({ entryId: null, name: 'Afwassen' })).toBeNull();
    expect(buildUpdateChorePayload({ entryId: 'e1', name: '   ' })).toBeNull();
  });

  it('only sends the fields that changed', () => {
    const payload = buildUpdateChorePayload({ entryId: 'e1', name: ' Afwassen ', points: 7.4 });

    expect(payload).toEqual({ config_entry_id: 'e1', name: 'Afwassen', points: 7 });
  });

  it('replaces the assignee list explicitly', () => {
    const payload = buildUpdateChorePayload({
      entryId: 'e1',
      name: 'Afwassen',
      assignedUserNames: ['Maya', ' Maya ', 'Nova'],
    });

    expect(payload).toMatchObject({
      assignment_action: 'replace',
      assigned_user_names: ['Maya', 'Nova'],
    });
  });

  it('sends ChoreOps the stable chore ID, new name, and all-users sentinel', () => {
    const payload = buildUpdateChorePayload({
      entryId: 'e1',
      choreId: '023e4567-e89b-12d3-a456-426614174000',
      name: 'Tafel dekken',
      assignedUserNames: ['*'],
    });

    expect(payload).toEqual({
      config_entry_id: 'e1',
      id: '023e4567-e89b-12d3-a456-426614174000',
      name: 'Tafel dekken',
      assignment_action: 'replace',
      assigned_user_names: ['*'],
    });
    // ChoreOps resolves this request sentinel to all assignable user IDs.
  });

  it('does not send the create-only completion rule on updates', () => {
    const payload = buildUpdateChorePayload({
      entryId: 'e1',
      name: 'Afwassen',
      assignedUserNames: ['Maya'],
    });

    expect(payload).not.toHaveProperty('completion_criteria');
  });

  it('sends schedule fields together with the due date ChoreOps requires', () => {
    const payload = buildUpdateChorePayload({
      entryId: 'e1',
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
      entryId: 'e1',
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
    const cleared = buildUpdateChorePayload({ entryId: 'e1', name: 'Afwassen', windowOffset: '' });
    expect(cleared).toMatchObject({ due_window_offset: '0' });
    expect(cleared).not.toHaveProperty('due_reminder_offset');

    const withReminder = buildUpdateChorePayload({
      entryId: 'e1',
      name: 'Afwassen',
      reminderOffset: ' 30m ',
    });
    expect(withReminder).toMatchObject({ due_reminder_offset: '30m' });
  });

  it('can clear weekly applicable days with the native update service', () => {
    expect(
      buildUpdateChorePayload({
        entryId: 'e1',
        name: 'Afwassen',
        applicableDays: [],
      }),
    ).toMatchObject({ applicable_days: [] });
  });

  it('sends the custom interval only for custom repeats', () => {
    const custom = buildUpdateChorePayload({
      entryId: 'e1',
      name: 'Planten',
      frequency: 'custom',
      customInterval: 3,
      customIntervalUnit: 'weeks',
    });
    expect(custom).toMatchObject({ custom_interval: 3, custom_interval_unit: 'weeks' });

    const daily = buildUpdateChorePayload({
      entryId: 'e1',
      name: 'Planten',
      frequency: 'daily',
      customInterval: 3,
    });
    expect(daily).not.toHaveProperty('custom_interval');
  });
});
