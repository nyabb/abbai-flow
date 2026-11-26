import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const {
  listCaldavCalendarsMock,
  fetchCaldavEventsMock,
  createCaldavEventMock,
  updateCaldavEventMock,
  deleteCaldavEventMock,
} = vi.hoisted(() => ({
  listCaldavCalendarsMock: vi.fn(),
  fetchCaldavEventsMock: vi.fn(),
  createCaldavEventMock: vi.fn(),
  updateCaldavEventMock: vi.fn(),
  deleteCaldavEventMock: vi.fn(),
}));

vi.mock('../api/caldav-calendars', () => ({
  createCaldavEvent: createCaldavEventMock,
  deleteCaldavEvent: deleteCaldavEventMock,
  fetchCaldavEvents: fetchCaldavEventsMock,
  listCaldavCalendars: listCaldavCalendarsMock,
  updateCaldavEvent: updateCaldavEventMock,
}));

import { useCalendarEvents } from './useCalendarEvents';

function calendar(id: string, name = id) {
  return { id: `caldav/${id}`, name, sourceId: 'test-source' };
}

function event(id: string, title: string, start: string) {
  return {
    id,
    title,
    start,
    end: '2026-01-01T13:00:00.000Z',
    allDay: false,
    hasStableId: true,
  };
}

describe('useCalendarEvents', () => {
  beforeEach(() => {
    listCaldavCalendarsMock.mockReset();
    listCaldavCalendarsMock.mockResolvedValue([calendar('a', 'A'), calendar('b', 'B')]);
    fetchCaldavEventsMock.mockReset();
    fetchCaldavEventsMock.mockResolvedValue([]);
    createCaldavEventMock.mockReset();
    updateCaldavEventMock.mockReset();
    deleteCaldavEventMock.mockReset();
  });

  it('loads CalDAV calendars and merges their events in start order', async () => {
    fetchCaldavEventsMock.mockImplementation(async (calendarId: string) =>
      calendarId.endsWith('/a')
        ? [event('a1', 'Later', '2026-01-01T12:00:00.000Z')]
        : [event('b1', 'Earlier', '2026-01-01T08:00:00.000Z')],
    );

    const { result } = renderHook(() => useCalendarEvents());
    await act(async () => {
      await result.current.fetchEvents('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    });

    expect(listCaldavCalendarsMock).toHaveBeenCalledOnce();
    expect(result.current.calendars.map(({ id, name }) => [id, name])).toEqual([
      ['caldav/a', 'A'],
      ['caldav/b', 'B'],
    ]);
    expect(result.current.events.map((item) => item.title)).toEqual(['Earlier', 'Later']);
    expect(result.current.events[0]).toMatchObject({
      calendarId: 'caldav/b',
      calendarName: 'B',
    });
    expect(result.current.loading).toBe(false);
  });

  it('keeps events from working calendars when one CalDAV source fails', async () => {
    fetchCaldavEventsMock.mockImplementation(async (calendarId: string) => {
      if (calendarId.endsWith('/b')) throw new Error('provider down');
      return [event('a1', 'Still available', '2026-01-01T10:00:00.000Z')];
    });

    const { result } = renderHook(() => useCalendarEvents());
    await act(async () => {
      await result.current.fetchEvents('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0].calendarId).toBe('caldav/a');
  });

  it('queries CalDAV calendars concurrently within the configured limit', async () => {
    const calendars = Array.from({ length: 14 }, (_, index) => calendar(`c${index}`));
    listCaldavCalendarsMock.mockResolvedValue(calendars);

    let active = 0;
    let peak = 0;
    fetchCaldavEventsMock.mockImplementation(async (calendarId: string) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return [event(`${calendarId}-event`, calendarId, '2026-01-01T10:00:00.000Z')];
    });

    const { result } = renderHook(() => useCalendarEvents());
    await act(async () => {
      await result.current.fetchEvents('2026-01-01T00:00:00Z', '2026-01-02T00:00:00Z');
    });

    expect(result.current.events).toHaveLength(14);
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });

  it('does not let an earlier range overwrite a more recent response', async () => {
    listCaldavCalendarsMock.mockResolvedValue([calendar('a')]);
    fetchCaldavEventsMock.mockImplementation(async (_calendarId: string, start: string) => {
      if (start === 'slow') {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return [event('old', 'Old range', '2026-01-01T10:00:00.000Z')];
      }
      return [event('new', 'New range', '2026-01-02T10:00:00.000Z')];
    });

    const { result } = renderHook(() => useCalendarEvents());
    await act(async () => {
      await result.current.fetchCalendars();
    });
    await act(async () => {
      const slow = result.current.fetchEvents('slow', 'slow-end');
      const fast = result.current.fetchEvents('fast', 'fast-end');
      await Promise.allSettled([slow, fast]);
    });

    expect(result.current.events).toHaveLength(1);
    expect(result.current.events[0].title).toBe('New range');
  });

  it('routes event create, update, and delete through CalDAV', async () => {
    const { result } = renderHook(() => useCalendarEvents());
    await act(async () => {
      await result.current.createEvent('caldav/source/calendar', { summary: 'Dinner' });
      await result.current.updateEvent('caldav/source/calendar', 'event-id', {
        summary: 'Dinner moved',
      });
      await result.current.deleteEvent('caldav/source/calendar', 'event-id');
    });

    expect(createCaldavEventMock).toHaveBeenCalledWith('caldav/source/calendar', {
      summary: 'Dinner',
    });
    expect(updateCaldavEventMock).toHaveBeenCalledWith('caldav/source/calendar', 'event-id', {
      summary: 'Dinner moved',
    });
    expect(deleteCaldavEventMock).toHaveBeenCalledWith('caldav/source/calendar', 'event-id');
  });

  it('rejects event changes for calendars not backed by CalDAV', async () => {
    const { result } = renderHook(() => useCalendarEvents());

    await expect(
      result.current.createEvent('external/calendar', { summary: 'Dinner' }),
    ).rejects.toThrow('This calendar does not support event changes.');
    expect(createCaldavEventMock).not.toHaveBeenCalled();
  });
});
