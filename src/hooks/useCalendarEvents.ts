import { useState, useCallback, useRef, useEffect } from 'react';
import { CalendarEvent, CalendarInfo, CalendarColorMember, resolveCalendarColor } from '../types';
import { haFetch, hasToken, callAbbaiAction, AbbaiActionError } from '../api/ha-rest';
import { HomeAssistantClient, toWsEventPayload } from '../api/homeassistant';
import { mapWithConcurrency, isAbortError } from '../utils/bounded-map';

/** How many calendars are queried at the same time. */
const CALENDAR_CONCURRENCY = 6;

/** Shape of a raw HA calendar event, before normalisation. */
interface RawCalendarEvent {
  uid?: string;
  summary: string;
  start: string | { dateTime?: string; date?: string };
  end: string | { dateTime?: string; date?: string };
  description?: string;
  location?: string;
  recurrence_id?: string;
}

/**
 * Load one calendar's events and normalise them.
 *
 * A failing (or aborted) calendar yields `[]` so the other calendars still
 * populate the view — one unreadable provider must not blank the dashboard.
 */
async function loadCalendarEvents(
  cal: CalendarInfo,
  start: string,
  end: string,
  signal: AbortSignal,
): Promise<CalendarEvent[]> {
  const params = new URLSearchParams({ start, end });
  try {
    const result = (await haFetch(`/api/calendars/${cal.id}?${params}`, { signal })) as
      | RawCalendarEvent[]
      | null;

    return (result || []).map((ev, index) => {
      const startStr =
        typeof ev.start === 'string' ? ev.start : ev.start.dateTime || ev.start.date || '';
      const endStr = typeof ev.end === 'string' ? ev.end : ev.end.dateTime || ev.end.date || '';
      const allDay =
        typeof ev.start === 'string'
          ? ev.start.length === 10
          : Boolean(ev.start.date) && !ev.start.dateTime;

      // Prefer a real provider uid. Some calendar integrations don't return
      // one — fall back to a composite id for keys, but flag it as unstable so
      // edit/delete (which need a real uid) can be blocked with a clear error.
      const realUid = ev.uid || ev.recurrence_id;

      return {
        id: realUid || `${cal.id}-${index}`,
        title: ev.summary,
        start: startStr,
        end: endStr,
        allDay,
        description: ev.description,
        location: ev.location,
        calendarId: cal.id,
        calendarName: cal.name,
        color: cal.color,
        hasStableId: Boolean(realUid),
      };
    });
  } catch (err) {
    if (!isAbortError(err)) console.error(`Failed to fetch events for ${cal.name}:`, err);
    return [];
  }
}

/**
 * Re-thrown by createEvent/updateEvent/deleteEvent when HA reports the calendar
 * doesn't support that operation (CalendarEntityFeature.CREATE_EVENT /
 * UPDATE_EVENT / DELETE_EVENT unset — common for many read-only or limited
 * providers). Callers can catch this specifically to offer a fallback (e.g.
 * delete + recreate for updates) instead of showing a raw error.
 */
export class CalendarNotSupportedError extends Error {
  constructor(op: 'create' | 'update' | 'delete') {
    super(
      `This calendar does not support event ${op === 'create' ? 'creation' : op === 'update' ? 'editing' : 'deletion'}.`,
    );
    this.name = 'CalendarNotSupportedError';
  }
}

function isNotSupported(err: unknown): boolean {
  if (err instanceof AbbaiActionError) return err.code === 'not_supported';
  if (err && typeof err === 'object' && 'code' in err)
    return (err as { code?: string }).code === 'not_supported';
  return false;
}

/**
 * Calendar events hook — uses HA REST API via haFetch.
 * Works with both direct HA connections and the add-on API proxy.
 * The `connected` flag indicates whether the HA API is reachable.
 *
 * `colorOptions` lets callers pass user-customized calendar colors and
 * family members so calendar/event colors resolve identically here as on
 * the Dashboard (user override > family-member-linked color > positional
 * palette fallback) — see resolveCalendarColor in ../types.
 */
export function useCalendarEvents(
  connected: boolean,
  colorOptions?: {
    calendarColors?: Record<string, string>;
    members?: CalendarColorMember[];
  },
  getClient?: () => HomeAssistantClient | null,
) {
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const calendarsRef = useRef<CalendarInfo[]>([]);
  const colorOptionsRef = useRef(colorOptions);
  colorOptionsRef.current = colorOptions;
  /** Identifies the most recent `fetchEvents` call, so stale responses lose. */
  const requestIdRef = useRef(0);
  /** Aborts the previous fan-out when a new range is requested. */
  const abortRef = useRef<AbortController | null>(null);

  // Drop any in-flight fan-out when the consumer unmounts.
  useEffect(() => () => abortRef.current?.abort(), []);

  const fetchCalendars = useCallback(async () => {
    if (!connected && !hasToken()) return [];

    try {
      const data = (await haFetch('/api/calendars')) as Array<{ entity_id: string; name: string }>;
      const cals = data.map((cal, index) => ({
        id: cal.entity_id,
        name: cal.name,
        color: resolveCalendarColor(cal.entity_id, index, colorOptionsRef.current),
      }));
      calendarsRef.current = cals;
      setCalendars(cals);
      return cals;
    } catch (err) {
      console.error('Failed to fetch calendars:', err);
      return [];
    }
  }, [connected]);

  const fetchEvents = useCallback(
    async (start: string, end: string) => {
      if (!connected && !hasToken()) return;

      // A new range supersedes the previous fan-out: abort it and tag the results
      // so a slow calendar can never overwrite a newer fetch.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      setLoading(true);
      try {
        let cals = calendarsRef.current;
        if (cals.length === 0) {
          cals = (await fetchCalendars()) || [];
        }
        if (cals.length === 0) return;

        // Fetch every calendar with bounded concurrency: a household with many
        // calendars should not serialise N round-trips, and should not flood HA
        // with N parallel ones either. One failing calendar keeps the rest.
        const perCalendar = await mapWithConcurrency(
          cals,
          CALENDAR_CONCURRENCY,
          (cal) => loadCalendarEvents(cal, start, end, controller.signal),
          () => [] as CalendarEvent[],
        );

        if (requestIdRef.current !== requestId) return;

        const allEvents = perCalendar.flat();
        allEvents.sort((a, b) => a.start.localeCompare(b.start));
        setEvents(allEvents);
      } finally {
        if (requestIdRef.current === requestId) setLoading(false);
      }
    },
    [connected, fetchCalendars],
  );

  /**
   * Create a new calendar event. HA requires the calendar/event/create WS
   * command (not calendar.create_event REST service) to support recurring
   * events (rrule) — the service silently ignores/rejects rrule. When a live
   * HomeAssistantClient is available (standalone mode, direct browser WS
   * connection), this calls its createEvent method directly. Otherwise
   * (add-on/proxy mode, no browser-side token) it routes through the add-on
   * server's /beacon-action/calendar-event bridge, which opens the WS
   * connection server-side using SUPERVISOR_TOKEN.
   *
   * Many calendar providers don't support event creation at all
   * (CalendarEntityFeature.CREATE_EVENT unset) — HA reports that as error
   * code "not_supported", which is normalized here into
   * CalendarNotSupportedError so callers can detect it and show a clear
   * message instead of a raw error.
   */
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
      try {
        const client = getClient?.();
        if (client?.isConnected) {
          await client.createEvent(calendarId, event);
        } else {
          await callAbbaiAction('/beacon-action/calendar-event', {
            op: 'create',
            entity_id: calendarId,
            event: toWsEventPayload(event),
          });
        }
      } catch (err) {
        if (isNotSupported(err)) throw new CalendarNotSupportedError('create');
        throw err;
      }
    },
    [getClient],
  );

  /**
   * Update an existing event. HA moved this off the `calendar.update_event`
   * REST service to a WS-only command in current core (see
   * homeassistant/components/calendar/__init__.py) — POSTing to
   * /api/services/calendar/update_event now 400s because the service no
   * longer exists. When a live HomeAssistantClient is available
   * (standalone mode, direct browser WS connection), this calls its
   * updateEvent method directly. Otherwise (add-on/proxy mode, no
   * browser-side token) it routes through the add-on server's
   * /beacon-action/calendar-event bridge, which opens the WS connection
   * server-side using SUPERVISOR_TOKEN.
   *
   * Many calendar providers don't support event updates at all
   * (CalendarEntityFeature.UPDATE_EVENT unset) — HA reports that as error
   * code "not_supported", which is normalized here into
   * CalendarNotSupportedError so callers can detect it and offer a
   * delete+recreate fallback instead of showing a raw error.
   */
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
      try {
        const client = getClient?.();
        if (client?.isConnected) {
          await client.updateEvent(calendarId, uid, event);
        } else {
          await callAbbaiAction('/beacon-action/calendar-event', {
            op: 'update',
            entity_id: calendarId,
            uid,
            event: toWsEventPayload(event),
          });
        }
      } catch (err) {
        if (isNotSupported(err)) throw new CalendarNotSupportedError('update');
        throw err;
      }
    },
    [getClient],
  );

  /**
   * Delete an event. Same WS-only migration and not-supported handling as
   * updateEvent above — see that doc comment for the full explanation.
   */
  const deleteEvent = useCallback(
    async (calendarId: string, uid: string) => {
      try {
        const client = getClient?.();
        if (client?.isConnected) {
          await client.deleteEvent(calendarId, uid);
        } else {
          await callAbbaiAction('/beacon-action/calendar-event', {
            op: 'delete',
            entity_id: calendarId,
            uid,
          });
        }
      } catch (err) {
        if (isNotSupported(err)) throw new CalendarNotSupportedError('delete');
        throw err;
      }
    },
    [getClient],
  );

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
