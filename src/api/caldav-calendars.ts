import { getRuntimeConfig } from '../config';
import type { CalendarEvent } from '../types';
import type { CalendarSourceSetting } from './integration-settings';

export interface CaldavEventInput {
  summary: string;
  start_date_time?: string;
  end_date_time?: string;
  start_date?: string;
  end_date?: string;
  description?: string;
  location?: string;
  rrule?: string;
}

export interface CaldavCalendar {
  id: string;
  name: string;
  sourceId: string;
  readOnly?: boolean;
}

function endpoint(path: string): string {
  const base = getRuntimeConfig() ? window.location.pathname.replace(/\/$/u, '') : '';
  return `${base}${path}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint(path), {
    ...init,
    headers: {
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
    cache: 'no-store',
  });
  const payload = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) throw new Error(payload.error || `CalDAV request failed (HTTP ${response.status}).`);
  return payload;
}

export async function listCaldavCalendars(): Promise<CaldavCalendar[]> {
  if (!getRuntimeConfig()) return [];
  const result = await request<{ calendars: CaldavCalendar[] }>('/abbai-flow/calendars');
  return result.calendars || [];
}

export async function fetchCaldavEvents(
  calendarId: string,
  start: string,
  end: string,
): Promise<CalendarEvent[]> {
  const query = new URLSearchParams({ calendarId, start, end });
  const result = await request<{ events: CalendarEvent[] }>(
    `/abbai-flow/calendars/events?${query}`,
  );
  return result.events || [];
}

export async function testCalendarSource(
  source: CalendarSourceSetting,
): Promise<{ calendars: Array<{ id: string; name: string }>; calendarCount: number }> {
  return request('/abbai-flow/calendars/test', {
    method: 'POST',
    body: JSON.stringify({ source }),
  });
}

function normalizeEventDates(event: Partial<CaldavEventInput>): Partial<CaldavEventInput> {
  const normalized = { ...event };
  for (const key of ['start_date_time', 'end_date_time'] as const) {
    const value = normalized[key];
    if (value && !/(?:Z|[+-]\d{2}:?\d{2})$/u.test(value)) {
      const date = new Date(value);
      if (!Number.isFinite(date.getTime())) throw new Error('Enter a valid event date and time.');
      normalized[key] = date.toISOString();
    }
  }
  return normalized;
}

export function createCaldavEvent(calendarId: string, event: CaldavEventInput): Promise<{ ok: true }> {
  return request('/abbai-flow/calendars/event', {
    method: 'POST',
    body: JSON.stringify({ operation: 'create', calendarId, event: normalizeEventDates(event) }),
  });
}

export function updateCaldavEvent(
  calendarId: string,
  eventId: string,
  event: Partial<CaldavEventInput>,
): Promise<{ ok: true }> {
  return request('/abbai-flow/calendars/event', {
    method: 'POST',
    body: JSON.stringify({
      operation: 'update',
      calendarId,
      eventId,
      event: normalizeEventDates(event),
    }),
  });
}

export function deleteCaldavEvent(calendarId: string, eventId: string): Promise<{ ok: true }> {
  return request('/abbai-flow/calendars/event', {
    method: 'POST',
    body: JSON.stringify({ operation: 'delete', calendarId, eventId }),
  });
}
