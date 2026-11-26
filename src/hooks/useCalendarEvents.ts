import { useState, useCallback, useRef, useEffect } from 'react';
import { resolveCalendarColor } from '../types';
import type { CalendarEvent, CalendarInfo } from '../types';
import { mapWithConcurrency, isAbortError } from '../utils/bounded-map';
import {
  createCaldavEvent,
  deleteCaldavEvent,
  fetchCaldavEvents,
  listCaldavCalendars,
  updateCaldavEvent,
  type CaldavCalendar,
} from '../api/caldav-calendars';

/** How many calendars are queried at the same time. */
const CALENDAR_CONCURRENCY = 6;

function assertCaldavCalendar(calendarId: string): void {
  if (!calendarId.startsWith('caldav/')) {
    throw new Error('This calendar does not support event changes.');
  }
}

async function loadCalendarEvents(
  calendar: CalendarInfo,
  start: string,
  end: string,
): Promise<CalendarEvent[]> {
  try {
    const events = await fetchCaldavEvents(calendar.id, start, end);
    return events.map((event) => ({
      ...event,
      calendarId: calendar.id,
      calendarName: calendar.name,
      color: calendar.color,
      readOnly: calendar.readOnly || event.readOnly,
    }));
  } catch (error) {
    if (!isAbortError(error)) {
      console.error(`Failed to fetch events for ${calendar.name}:`, error);
    }
    return [];
  }
}

/** Calendar events from server-configured CalDAV sources. */
export function useCalendarEvents(colorOptions?: { calendarColors?: Record<string, string> }) {
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const calendarsRef = useRef<CalendarInfo[]>([]);
  const colorOptionsRef = useRef(colorOptions);
  colorOptionsRef.current = colorOptions;
  const requestIdRef = useRef(0);

  useEffect(
    () => () => {
      // Invalidate in-flight responses after unmount.
      requestIdRef.current += 1;
    },
    [],
  );

  const fetchCalendars = useCallback(async () => {
    let sources: CaldavCalendar[] = [];
    try {
      sources = await listCaldavCalendars();
    } catch (error) {
      console.error('Failed to fetch CalDAV calendars:', error);
    }

    const nextCalendars = sources.map((calendar, index) => ({
      id: calendar.id,
      name: calendar.name,
      color: resolveCalendarColor(calendar.id, index, colorOptionsRef.current),
      readOnly: calendar.readOnly,
    }));
    calendarsRef.current = nextCalendars;
    setCalendars(nextCalendars);
    return nextCalendars;
  }, []);

  const fetchEvents = useCallback(
    async (start: string, end: string) => {
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      try {
        const currentCalendars =
          calendarsRef.current.length > 0 ? calendarsRef.current : await fetchCalendars();
        if (requestIdRef.current !== requestId) return;
        if (currentCalendars.length === 0) {
          setEvents([]);
          return;
        }

        const perCalendar = await mapWithConcurrency(
          currentCalendars,
          CALENDAR_CONCURRENCY,
          (calendar) => loadCalendarEvents(calendar, start, end),
          () => [] as CalendarEvent[],
        );
        if (requestIdRef.current !== requestId) return;

        const nextEvents = perCalendar.flat().sort((a, b) => a.start.localeCompare(b.start));
        setEvents(nextEvents);
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    },
    [fetchCalendars],
  );

  const createEvent = useCallback(
    async (
      calendarId: string,
      event: {
        summary: string;
        start_date_time?: string;
        end_date_time?: string;
        start_date?: string;
        end_date?: string;
        description?: string;
        location?: string;
        rrule?: string;
      },
    ) => {
      assertCaldavCalendar(calendarId);
      await createCaldavEvent(calendarId, event);
    },
    [],
  );

  const updateEvent = useCallback(
    async (
      calendarId: string,
      uid: string,
      event: {
        summary?: string;
        start_date_time?: string;
        end_date_time?: string;
        start_date?: string;
        end_date?: string;
        description?: string;
      },
    ) => {
      assertCaldavCalendar(calendarId);
      await updateCaldavEvent(calendarId, uid, event);
    },
    [],
  );

  const deleteEvent = useCallback(async (calendarId: string, uid: string) => {
    assertCaldavCalendar(calendarId);
    await deleteCaldavEvent(calendarId, uid);
  }, []);

  return {
    calendars,
    events,
    loading,
    fetchCalendars,
    fetchEvents,
    createEvent,
    updateEvent,
    deleteEvent,
  };
}
