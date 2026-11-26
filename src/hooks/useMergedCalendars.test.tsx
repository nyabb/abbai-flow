import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useMergedCalendars } from './useMergedCalendars';
import { useCalendarEvents } from './useCalendarEvents';
import { useLocalCalendar } from './useLocalCalendar';
import type { ChoresManChore } from '../types/choresman';

vi.mock('./useCalendarEvents', () => ({ useCalendarEvents: vi.fn() }));
vi.mock('./useLocalCalendar', () => ({ useLocalCalendar: vi.fn() }));

const localCalendar = { id: 'local', name: 'Local', color: '#6366f1' };

const localApi = {
  calendar: localCalendar,
  events: [
    { id: 'l1', title: 'Local late', start: '2026-01-02T10:00:00Z', end: '2026-01-02T11:00:00Z' },
  ],
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
  refresh: vi.fn(),
};

const caldavApi = {
  calendars: [{ id: 'caldav/home', name: 'Home', color: '#22c55e' }],
  events: [
    { id: 'c1', title: 'CalDAV early', start: '2026-01-02T08:00:00Z', end: '2026-01-02T09:00:00Z' },
  ],
  fetchCalendars: vi.fn(),
  fetchEvents: vi.fn(),
  createEvent: vi.fn(),
  updateEvent: vi.fn(),
  deleteEvent: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(useLocalCalendar).mockReturnValue(localApi as never);
  vi.mocked(useCalendarEvents).mockReturnValue(caldavApi as never);
});

describe('useMergedCalendars', () => {
  it('puts the local calendar first and merges events by start time', () => {
    const { result } = renderHook(() => useMergedCalendars());

    expect(result.current.calendars.map((calendar) => calendar.id)).toEqual([
      'local',
      'caldav/home',
    ]);
    expect(result.current.events.map((event) => event.id)).toEqual(['c1', 'l1']);
    expect(result.current.events.find((event) => event.id === 'l1')?.color).toBe('#6366f1');
  });

  it('routes create/update/delete for the local calendar to the local store', async () => {
    const { result } = renderHook(() => useMergedCalendars());

    await result.current.createEvent('local', { summary: 'Dinner' });
    await result.current.updateEvent('local', 'l1', { summary: 'Dinner 2' });
    await result.current.deleteEvent('local', 'l1');

    expect(localApi.createEvent).toHaveBeenCalledWith({ summary: 'Dinner' });
    expect(localApi.updateEvent).toHaveBeenCalledWith('l1', { summary: 'Dinner 2' });
    expect(localApi.deleteEvent).toHaveBeenCalledWith('l1');
    expect(caldavApi.createEvent).not.toHaveBeenCalled();
    expect(caldavApi.updateEvent).not.toHaveBeenCalled();
    expect(caldavApi.deleteEvent).not.toHaveBeenCalled();
  });

  it('routes external calendar CRUD to CalDAV', async () => {
    const { result } = renderHook(() => useMergedCalendars());

    await result.current.createEvent('caldav/home', { summary: 'Dinner' });
    await result.current.updateEvent('caldav/home', 'c1', { summary: 'Dinner 2' });
    await result.current.deleteEvent('caldav/home', 'c1');

    expect(caldavApi.createEvent).toHaveBeenCalledWith('caldav/home', { summary: 'Dinner' });
    expect(caldavApi.updateEvent).toHaveBeenCalledWith('caldav/home', 'c1', {
      summary: 'Dinner 2',
    });
    expect(caldavApi.deleteEvent).toHaveBeenCalledWith('caldav/home', 'c1');
    expect(localApi.createEvent).not.toHaveBeenCalled();
  });

  it('merges generated ChoresMan calendars and fetches their scheduled events', async () => {
    const chores: ChoresManChore[] = [
      {
        id: 'choresman:chore-1:zara',
        sourceId: 'chore-1',
        name: 'Wash dishes',
        icon: null,
        status: 'pending',
        assignee: 'Zara',
        points: 1,
        dueDate: '2026-11-26',
        showOnCalendar: true,
        frequency: 'weekly',
        applicableDays: ['thu'],
        canClaim: true,
        canApprove: false,
        actions: {},
      },
    ];
    const members = [
      { id: 'zara', name: 'Zara', role: 'child' as const, color: '#22c55e', avatar: '🙂' },
    ];
    const { result } = renderHook(() => useMergedCalendars({ members, chores }));

    expect(result.current.fetchCalendars).toBe(caldavApi.fetchCalendars);
    expect(result.current.calendars.map((calendar) => calendar.id)).toContain('choresman:zara');

    await act(async () => {
      await result.current.fetchEvents('2026-11-23T00:00:00', '2026-12-07T00:00:00');
    });

    expect(caldavApi.fetchEvents).toHaveBeenCalledWith(
      '2026-11-23T00:00:00',
      '2026-12-07T00:00:00',
    );
    expect(
      result.current.events
        .filter((event) => event.calendarId === 'choresman:zara')
        .map((event) => event.start),
    ).toEqual(['2026-11-26', '2026-12-03']);
  });
});
