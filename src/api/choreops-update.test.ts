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
