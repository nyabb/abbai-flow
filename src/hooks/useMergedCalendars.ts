/**
 * Calendar orchestration for the app shell.
 *
 * Abbai Flow shows two kinds of calendars side by side: the device-local calendar
 * (stored in Abbai Flow's own persistence) and the calendars Home Assistant
 * publishes. Both are merged into one list so the dashboard, week view and
 * event modal never need to know where an event lives — they just call
 * `createEvent`/`updateEvent`/`deleteEvent` and this hook routes to the right
 * store.
 *
 * Extracted from App.tsx so the shell renders rather than orchestrates, and so
 * the routing rules are testable in isolation.
 */
import { useCallback, useMemo } from 'react';
import { useCalendarEvents } from './useCalendarEvents';
import { useLocalCalendar } from './useLocalCalendar';
import { resolveCalendarColor } from '../types';
import type { CalendarColorMember, CalendarEvent, CalendarInfo } from '../types';
import type { HomeAssistantClient } from '../api/homeassistant';

type CalendarApi = ReturnType<typeof useCalendarEvents>;
export type CalendarEventInput = Parameters<CalendarApi['createEvent']>[1];
export type CalendarEventUpdate = Parameters<CalendarApi['updateEvent']>[2];

export interface UseMergedCalendarsOptions {
  /** True when the HA API is reachable (live client or proxy token). */
  connected: boolean;
  /** Client factory for direct WS calls in standalone mode. */
  getClient?: () => HomeAssistantClient | null;
  calendarColors?: Record<string, string>;
  members?: CalendarColorMember[];
}

export interface UseMergedCalendarsResult {
  /** Local calendar first, then every HA calendar. */
  calendars: CalendarInfo[];
  /** Local events + HA events, sorted by start. */
  events: CalendarEvent[];
  fetchCalendars: CalendarApi['fetchCalendars'];
  fetchEvents: CalendarApi['fetchEvents'];
  createEvent: (calendarId: string, event: CalendarEventInput) => Promise<void>;
  updateEvent: (calendarId: string, uid: string, event: CalendarEventUpdate) => Promise<void>;
  deleteEvent: (calendarId: string, uid: string) => Promise<void>;
  /** The device-local calendar (its id is what routes CRUD calls). */
  localCalendar: ReturnType<typeof useLocalCalendar>['calendar'];
  localCalendarColor: string;
}

export function useMergedCalendars({
  connected,
  getClient,
  calendarColors,
  members,
}: UseMergedCalendarsOptions): UseMergedCalendarsResult {
  const ha = useCalendarEvents(connected, { calendarColors, members }, getClient);
  const local = useLocalCalendar();

  // Resolve the local calendar's colour the same way everywhere
  // (user override wins, otherwise its own default).
  const localCalendarColor = resolveCalendarColor(local.calendar.id, 0, {
    calendarColors,
    defaultColor: local.calendar.color,
  });

  const calendars = useMemo(
    () => [{ ...local.calendar, color: localCalendarColor }, ...ha.calendars],
    [local.calendar, localCalendarColor, ha.calendars],
  );

  const events = useMemo(
    () =>
      [
        ...local.events.map((event) => ({ ...event, color: localCalendarColor })),
        ...ha.events,
      ].sort((a, b) => a.start.localeCompare(b.start)),
    [local.events, localCalendarColor, ha.events],
  );

  const { createEvent: createHaEvent, updateEvent: updateHaEvent, deleteEvent: deleteHaEvent } = ha;
  const {
    calendar: localCalendar,
    createEvent: createLocalEvent,
    updateEvent: updateLocalEvent,
    deleteEvent: deleteLocalEvent,
  } = local;

  const createEvent = useCallback(
    async (calendarId: string, event: CalendarEventInput) => {
      if (calendarId === localCalendar.id) {
        createLocalEvent(event);
        return;
      }
      await createHaEvent(calendarId, event);
    },
    [localCalendar.id, createLocalEvent, createHaEvent],
  );

  const updateEvent = useCallback(
    async (calendarId: string, uid: string, event: CalendarEventUpdate) => {
      if (calendarId === localCalendar.id) {
        updateLocalEvent(uid, event);
        return;
      }
      await updateHaEvent(calendarId, uid, event);
    },
    [localCalendar.id, updateLocalEvent, updateHaEvent],
  );

  const deleteEvent = useCallback(
    async (calendarId: string, uid: string) => {
      if (calendarId === localCalendar.id) {
        deleteLocalEvent(uid);
        return;
      }
      await deleteHaEvent(calendarId, uid);
    },
    [localCalendar.id, deleteLocalEvent, deleteHaEvent],
  );

  return {
    calendars,
    events,
    fetchCalendars: ha.fetchCalendars,
    fetchEvents: ha.fetchEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    localCalendar,
    localCalendarColor,
  };
}
