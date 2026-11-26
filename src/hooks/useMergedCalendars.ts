/**
 * Calendar orchestration for the app shell.
 *
 * Abbai Flow shows two kinds of calendars side by side: the device-local calendar
 * (stored in Abbai Flow's own persistence) and the calendars Home Assistant
 * publishes. Both are merged into one list so the week view and
 * event modal never need to know where an event lives — they just call
 * `createEvent`/`updateEvent`/`deleteEvent` and this hook routes to the right
 * store.
 *
 * Extracted from App.tsx so the shell renders rather than orchestrates, and so
 * the routing rules are testable in isolation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCalendarEvents } from './useCalendarEvents';
import { useLocalCalendar } from './useLocalCalendar';
import { resolveCalendarColor } from '../types';
import type { CalendarEvent, CalendarInfo } from '../types';
import type { HomeAssistantClient } from '../api/homeassistant';
import type { ChoresManChore } from '../types/choresman';
import type { FamilyMember } from '../types/family';
import {
  CHORESMAN_CALENDAR_PREFIX,
  createChoresManCalendarEvents,
  createChoresManCalendars,
} from '../api/choresman-calendar';

type CalendarApi = ReturnType<typeof useCalendarEvents>;
const EMPTY_CHORES: ChoresManChore[] = [];
export type CalendarEventInput = Parameters<CalendarApi['createEvent']>[1];
export type CalendarEventUpdate = Parameters<CalendarApi['updateEvent']>[2];

export interface UseMergedCalendarsOptions {
  /** True when the HA API is reachable (live client or proxy token). */
  connected: boolean;
  /** Client factory for direct WS calls in standalone mode. */
  getClient?: () => HomeAssistantClient | null;
  calendarColors?: Record<string, string>;
  members?: FamilyMember[];
  chores?: ChoresManChore[];
}

export interface UseMergedCalendarsResult {
  /** Local calendar first, then every HA calendar. */
  calendars: CalendarInfo[];
  /** Local events + HA events, sorted by start. */
  events: CalendarEvent[];
  loading: boolean;
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
  chores = EMPTY_CHORES,
}: UseMergedCalendarsOptions): UseMergedCalendarsResult {
  const ha = useCalendarEvents(connected, { calendarColors, members }, getClient);
  const local = useLocalCalendar();
  const [choresManEvents, setChoresManEvents] = useState<CalendarEvent[]>([]);
  const lastRange = useRef<{ start: string; end: string } | null>(null);
  const choreCalendars = useMemo(
    () => createChoresManCalendars(members ?? [], calendarColors),
    [members, calendarColors],
  );
  const choreCalendarsRef = useRef(choreCalendars);
  const choresRef = useRef(chores);
  const membersRef = useRef(members ?? []);
  choreCalendarsRef.current = choreCalendars;
  choresRef.current = chores;
  membersRef.current = members ?? [];

  const refreshChoresManEvents = useCallback((start: string, end: string) => {
    setChoresManEvents(
      createChoresManCalendarEvents(
        choresRef.current,
        membersRef.current,
        choreCalendarsRef.current,
        start,
        end,
      ),
    );
  }, []);

  const fetchCalendars = useCallback(async () => {
    const loaded = await ha.fetchCalendars();
    return [...loaded, ...choreCalendarsRef.current];
  }, [ha.fetchCalendars]);

  const fetchEvents = useCallback(
    async (start: string, end: string) => {
      lastRange.current = { start, end };
      refreshChoresManEvents(start, end);
      await ha.fetchEvents(start, end);
    },
    [ha.fetchEvents, refreshChoresManEvents],
  );

  useEffect(() => {
    if (lastRange.current) {
      refreshChoresManEvents(lastRange.current.start, lastRange.current.end);
    }
  }, [chores, members, choreCalendars, refreshChoresManEvents]);

  // Resolve the local calendar's colour the same way everywhere
  // (user override wins, otherwise its own default).
  const localCalendarColor = resolveCalendarColor(local.calendar.id, 0, {
    calendarColors,
    defaultColor: local.calendar.color,
  });

  const calendars = useMemo(
    () => [{ ...local.calendar, color: localCalendarColor }, ...ha.calendars, ...choreCalendars],
    [local.calendar, localCalendarColor, ha.calendars, choreCalendars],
  );

  const events = useMemo(
    () =>
      [
        ...local.events.map((event) => ({ ...event, color: localCalendarColor })),
        ...ha.events,
        ...choresManEvents,
      ].sort((a, b) => a.start.localeCompare(b.start)),
    [local.events, localCalendarColor, ha.events, choresManEvents],
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
      if (calendarId.startsWith(CHORESMAN_CALENDAR_PREFIX)) {
        throw new Error('ChoresMan calendar events are managed from the chores view.');
      }
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
      if (calendarId.startsWith(CHORESMAN_CALENDAR_PREFIX)) {
        throw new Error('ChoresMan calendar events are managed from the chores view.');
      }
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
      if (calendarId.startsWith(CHORESMAN_CALENDAR_PREFIX)) {
        throw new Error('ChoresMan calendar events are managed from the chores view.');
      }
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
    loading: ha.loading,
    fetchCalendars,
    fetchEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    localCalendar,
    localCalendarColor,
  };
}
