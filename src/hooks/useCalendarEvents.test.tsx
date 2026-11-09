import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

const { haFetchMock } = vi.hoisted(() => ({ haFetchMock: vi.fn() }));

vi.mock('../api/ha-rest', () => ({
  haFetch: haFetchMock,
  hasToken: () => true,
  callBeaconAction: vi.fn(),
  BeaconActionError: class BeaconActionError extends Error {
    code: string | null = null;
    status = 0;
  },
}));

vi.mock('../api/homeassistant', () => ({
  HomeAssistantClient: class {},
  toWsEventPayload: (event: unknown) => event,
}));

import { useCalendarEvents } from './useCalendarEvents';

/** Three calendars, each returning one event. */
function calendarResponse(url: string) {
  const calendarId = url.split('/api/calendars/')[1]?.split('?')[0] ?? 'calendar.unknown';
  return [
    {
      uid: `${calendarId}-uid`,
      summary: calendarId,
      start: '2026-01-01T10:00:00',
      end: '2026-01-01T11:00:00',
    },
  ];
}

describe('useCalendarEvents', () => {
  beforeEach(() => {
    haFetchMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllTimers();
  });

  it('merges events from every calendar in start order', async () => {
    haFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/calendars') {
        return [
          { entity_id: 'calendar.b', name: 'B' },
          { entity_id: 'calendar.a', name: 'A' },
        ];
      }
      if (url.includes('calendar.a')) {
        return [
          { uid: 'a2', summary: 'Later', start: '2026-01-01T12:00:00', end: '2026-01-01T13:00:00' },
        ];
      }
      return [
        { uid: 'b1', summary: 'Earlier', start: '2026-01-01T08:00:00', end: '2026-01-01T09:00:00' },
      ];
    });

    const { result } = renderHook(() => useCalendarEvents(true));
    await act(async () => {
      await result.current.fetchEvents('2026-01-01T00:00:00', '2026-01-02T00:00:00');
    });

    await waitFor(() => expect(result.current.events).toHaveLength(2));
    expect(result.current.events.map((event) => event.title)).toEqual(['Earlier', 'Later']);
    expect(result.current.loading).toBe(false);
  });

  it('keeps the working calendars when one of them fails', async () => {
    haFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/calendars') {
        return [
          { entity_id: 'calendar.ok', name: 'Ok' },
          { entity_id: 'calendar.broken', name: 'Broken' },
        ];
      }
      if (url.includes('calendar.broken')) throw new Error('provider down');
      return calendarResponse(url);
    });

    const { result } = renderHook(() => useCalendarEvents(true));
    await act(async () => {
      await result.current.fetchEvents('2026-01-01T00:00:00', '2026-01-02T00:00:00');
    });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0].calendarId).toBe('calendar.ok');
  });

  it('queries calendars concurrently but never more than the limit', async () => {
    const calendars = Array.from({ length: 14 }, (_, index) => ({
      entity_id: `calendar.c${index}`,
      name: `C${index}`,
    }));

    let active = 0;
    let peak = 0;

    haFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/calendars') return calendars;
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return calendarResponse(url);
    });

    const { result } = renderHook(() => useCalendarEvents(true));
    await act(async () => {
      await result.current.fetchEvents('2026-01-01T00:00:00', '2026-01-02T00:00:00');
    });

    await waitFor(() => expect(result.current.events).toHaveLength(14));
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });

  it('ignores a superseded range so a slow response cannot overwrite a newer one', async () => {
    haFetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/calendars') return [{ entity_id: 'calendar.one', name: 'One' }];
      if (url.includes('start=slow')) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        return [
          {
            uid: 'old',
            summary: 'Old range',
            start: '2026-01-01T10:00:00',
            end: '2026-01-01T11:00:00',
          },
        ];
      }
      return [
        {
          uid: 'new',
          summary: 'New range',
          start: '2026-01-02T10:00:00',
          end: '2026-01-02T11:00:00',
        },
      ];
    });

    const { result } = renderHook(() => useCalendarEvents(true));

    await act(async () => {
      const slow = result.current.fetchEvents('slow', 'slow-end');
      const fast = result.current.fetchEvents('fast', 'fast-end');
      await Promise.allSettled([slow, fast]);
    });

    await waitFor(() => expect(result.current.events).toHaveLength(1));
    expect(result.current.events[0].title).toBe('New range');
  });
});
