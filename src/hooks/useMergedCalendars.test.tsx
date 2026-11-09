import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useMergedCalendars } from './useMergedCalendars';
import { useCalendarEvents } from './useCalendarEvents';
import { useLocalCalendar } from './useLocalCalendar';

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

const haApi = {
  calendars: [{ id: 'calendar.home', name: 'Home', color: '#22c55e' }],
  events: [
    { id: 'h1', title: 'HA early', start: '2026-01-02T08:00:00Z', end: '2026-01-02T09:00:00Z' },
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
  vi.mocked(useCalendarEvents).mockReturnValue(haApi as never);
});

describe('useMergedCalendars', () => {
  it('puts the local calendar first and merges events by start time', () => {
    const { result } = renderHook(() => useMergedCalendars({ connected: true }));

    expect(result.current.calendars.map((calendar) => calendar.id)).toEqual([
      'local',
      'calendar.home',
    ]);
    expect(result.current.events.map((event) => event.id)).toEqual(['h1', 'l1']);
    // Local events adopt the resolved local colour so the UI has one source.
    expect(result.current.events.find((event) => event.id === 'l1')?.color).toBe('#6366f1');
  });

  it('routes create/update/delete for the local calendar to the local store', async () => {
    const { result } = renderHook(() => useMergedCalendars({ connected: true }));

    await result.current.createEvent('local', { summary: 'Dinner' });
    await result.current.updateEvent('local', 'l1', { summary: 'Dinner 2' });
    await result.current.deleteEvent('local', 'l1');

    expect(localApi.createEvent).toHaveBeenCalledWith({ summary: 'Dinner' });
    expect(localApi.updateEvent).toHaveBeenCalledWith('l1', { summary: 'Dinner 2' });
    expect(localApi.deleteEvent).toHaveBeenCalledWith('l1');
    expect(haApi.createEvent).not.toHaveBeenCalled();
    expect(haApi.updateEvent).not.toHaveBeenCalled();
    expect(haApi.deleteEvent).not.toHaveBeenCalled();
  });

  it('routes everything else to Home Assistant', async () => {
    const { result } = renderHook(() => useMergedCalendars({ connected: true }));

    await result.current.createEvent('calendar.home', { summary: 'Dinner' });
    await result.current.updateEvent('calendar.home', 'h1', { summary: 'Dinner 2' });
    await result.current.deleteEvent('calendar.home', 'h1');

    expect(haApi.createEvent).toHaveBeenCalledWith('calendar.home', { summary: 'Dinner' });
    expect(haApi.updateEvent).toHaveBeenCalledWith('calendar.home', 'h1', { summary: 'Dinner 2' });
    expect(haApi.deleteEvent).toHaveBeenCalledWith('calendar.home', 'h1');
    expect(localApi.createEvent).not.toHaveBeenCalled();
  });

  it('exposes the HA fetch helpers unchanged', () => {
    const { result } = renderHook(() => useMergedCalendars({ connected: true }));
    expect(result.current.fetchCalendars).toBe(haApi.fetchCalendars);
    expect(result.current.fetchEvents).toBe(haApi.fetchEvents);
  });
});
