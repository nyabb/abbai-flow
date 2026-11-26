/**
 * Calendar orchestration for the app shell.
 *
 * Combines the local Abbai Flow calendar, configured CalDAV calendars, and
 * read-only ChoresMan calendars into one view. Event operations are routed to
 * the owning provider so the UI does not need provider-specific logic.
 *
 * Extracted from App.tsx so the shell renders rather than orchestrates, and so
 * the routing rules are testable in isolation.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCalendarEvents } from './useCalendarEvents';
import { useLocalCalendar } from './useLocalCalendar';
import { resolveCalendarColor } from '../types';
import type { CalendarEvent, CalendarInfo } from '../types';
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
  calendarColors?: Record<string, string>;
  members?: FamilyMember[];
  chores?: ChoresManChore[];
}

export interface UseMergedCalendarsResult {
  /** Local calendar, configured CalDAV calendars, then ChoresMan calendars. */
  calendars: CalendarInfo[];
  /** Local events, CalDAV events, and ChoresMan events, sorted by start. */
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
  calendarColors,
  members,
  chores = EMPTY_CHORES,
}: UseMergedCalendarsOptions = {}): UseMergedCalendarsResult {
  const caldav = useCalendarEvents({ calendarColors });
  const { fetchEvents: fetchCaldavEvents } = caldav;
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

  const fetchEvents = useCallback(
    async (start: string, end: string) => {
      lastRange.current = { start, end };
      refreshChoresManEvents(start, end);
      await fetchCaldavEvents(start, end);
    },
    [fetchCaldavEvents, refreshChoresManEvents],
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
    () => [
      { ...local.calendar, color: localCalendarColor },
      ...caldav.calendars,
      ...choreCalendars,
    ],
    [local.calendar, localCalendarColor, caldav.calendars, choreCalendars],
  );

  const events = useMemo(
    () =>
      [
        ...local.events.map((event) => ({ ...event, color: localCalendarColor })),
        ...caldav.events,
        ...choresManEvents,
      ].sort((a, b) => a.start.localeCompare(b.start)),
    [local.events, localCalendarColor, caldav.events, choresManEvents],
  );

  const {
    createEvent: createCaldavEvent,
    updateEvent: updateCaldavEvent,
    deleteEvent: deleteCaldavEvent,
  } = caldav;
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
      await createCaldavEvent(calendarId, event);
    },
    [localCalendar.id, createLocalEvent, createCaldavEvent],
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
      await updateCaldavEvent(calendarId, uid, event);
    },
    [localCalendar.id, updateLocalEvent, updateCaldavEvent],
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
      await deleteCaldavEvent(calendarId, uid);
    },
    [localCalendar.id, deleteLocalEvent, deleteCaldavEvent],
  );

  return {
    calendars,
    events,
    loading: caldav.loading,
    fetchCalendars: caldav.fetchCalendars,
    fetchEvents,
    createEvent,
    updateEvent,
    deleteEvent,
    localCalendar,
    localCalendarColor,
  };
}
