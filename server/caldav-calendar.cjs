const { randomUUID } = require('crypto');
const { createDAVClient } = require('tsdav');
const ICAL = require('ical.js');

const EVENT_ID_PREFIX = 'dav:';
const EVENT_ID_LIMIT = 8192;
const CALENDAR_CACHE_TTL_MS = 5 * 60 * 1000;

function calendarId(sourceId, calendarUrl) {
  return `caldav/${sourceId}/${Buffer.from(calendarUrl).toString('base64url')}`;
}

function decodeCalendarId(value) {
  if (typeof value !== 'string') throw new Error('Choose a CalDAV calendar.');
  const match = value.match(/^caldav\/([^/]+)\/([A-Za-z0-9_-]+)$/u);
  if (!match) throw new Error('Choose a valid CalDAV calendar.');
  let calendarUrl;
  try {
    calendarUrl = Buffer.from(match[2], 'base64url').toString('utf8');
    const parsed = new URL(calendarUrl);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('invalid calendar URL');
    }
  } catch {
    throw new Error('Choose a valid CalDAV calendar.');
  }
  return { sourceId: match[1], calendarUrl };
}

function encodeEventId(value) {
  return `${EVENT_ID_PREFIX}${Buffer.from(JSON.stringify(value)).toString('base64url')}`;
}

function decodeEventId(value) {
  if (typeof value !== 'string' || value.length > EVENT_ID_LIMIT || !value.startsWith(EVENT_ID_PREFIX)) {
    throw new Error('This event has no supported CalDAV identifier.');
  }
  try {
    const payload = JSON.parse(
      Buffer.from(value.slice(EVENT_ID_PREFIX.length), 'base64url').toString('utf8'),
    );
    if (
      !payload ||
      typeof payload.url !== 'string' ||
      typeof payload.uid !== 'string' ||
      typeof payload.recurrenceId !== 'string'
    ) {
      throw new Error('invalid event identifier');
    }
    const objectUrl = new URL(payload.url);
    if (!['http:', 'https:'].includes(objectUrl.protocol) || objectUrl.username || objectUrl.password) {
      throw new Error('invalid event URL');
    }
    return payload;
  } catch {
    throw new Error('This event has no supported CalDAV identifier.');
  }
}

function timeValue(time) {
  if (!time) return '';
  if (time.isDate) {
    return [time.year, String(time.month).padStart(2, '0'), String(time.day).padStart(2, '0')].join(
      '-',
    );
  }
  return time.toJSDate().toISOString();
}

function textValue(component, name) {
  const value = component.getFirstPropertyValue(name);
  return typeof value === 'string' ? value : '';
}

function parseCalendarObject(object, calendar) {
  if (typeof object.data !== 'string' || !object.data.trim()) return [];
  const parsed = new ICAL.Component(ICAL.parse(object.data));
  return parsed
    .getAllSubcomponents('vevent')
    .map((component) => {
      const event = new ICAL.Event(component);
      const recurrence = component.getFirstPropertyValue('recurrence-id');
      const recurrenceId = recurrence ? recurrence.toString() : '';
      const eventId = encodeEventId({ url: object.url, uid: event.uid, recurrenceId });
      return {
        id: eventId,
        title: event.summary || 'Untitled',
        start: timeValue(event.startDate),
        end: timeValue(event.endDate),
        allDay: Boolean(event.startDate?.isDate),
        description: textValue(component, 'description'),
        location: textValue(component, 'location'),
        hasStableId: Boolean(event.uid),
        recurrenceId,
        calendarId: calendar.id,
        calendarName: calendar.name,
        color: calendar.color,
      };
    })
    .filter((event, index) => {
      const component = parsed.getAllSubcomponents('vevent')[index];
      const status = String(component?.getFirstPropertyValue('status') || '').toUpperCase();
      return event.start && event.end && event.hasStableId && status !== 'CANCELLED';
    });
}

function escapeIcsText(value) {
  return String(value || '')
    .replace(/\\/gu, '\\\\')
    .replace(/\r?\n/gu, '\\n')
    .replace(/,/gu, '\\,')
    .replace(/;/gu, '\\;');
}

function foldIcsLine(value) {
  const lines = [];
  let current = '';
  for (const character of value) {
    if (Buffer.byteLength(current + character, 'utf8') > 73) {
      lines.push(current);
      current = ` ${character}`;
    } else {
      current += character;
    }
  }
  lines.push(current);
  return lines.join('\r\n');
}

function asIcsDateTime(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Enter a valid event date and time.');
  return date.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
}

function asIcsDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw new Error('Enter a valid all-day event date.');
  }
  return value.replace(/-/gu, '');
}

function normalizeEventInput(value) {
  const event = value && typeof value === 'object' ? value : {};
  const summary = typeof event.summary === 'string' ? event.summary.trim() : '';
  if (!summary) throw new Error('Enter a title for the calendar event.');
  const allDay = typeof event.start_date === 'string';
  const start = allDay ? asIcsDate(event.start_date) : asIcsDateTime(event.start_date_time);
  const end = allDay ? asIcsDate(event.end_date || event.start_date) : asIcsDateTime(event.end_date_time);
  if (allDay ? end <= start : new Date(event.end_date_time).getTime() <= new Date(event.start_date_time).getTime()) {
    throw new Error('The event end must be after its start.');
  }
  return { ...event, summary, allDay, start, end };
}

function buildCalendarObject(event, uid, now = new Date()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Abbai Flow//Calendar//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(uid)}`,
    `DTSTAMP:${asIcsDateTime(now.toISOString())}`,
    `${event.allDay ? 'DTSTART;VALUE=DATE' : 'DTSTART'}:${event.start}`,
    `${event.allDay ? 'DTEND;VALUE=DATE' : 'DTEND'}:${event.end}`,
    `SUMMARY:${escapeIcsText(event.summary)}`,
  ];
  if (typeof event.description === 'string' && event.description.trim()) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  if (typeof event.location === 'string' && event.location.trim()) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }
  if (typeof event.rrule === 'string' && event.rrule.trim()) {
    lines.push(`RRULE:${event.rrule.trim()}`);
  }
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

function updateComponentValue(component, name, value) {
  if (typeof value === 'string') component.updatePropertyWithValue(name, value);
}

function updateComponentTime(component, name, value, allDay) {
  const time = allDay
    ? ICAL.Time.fromDateString(value)
    : ICAL.Time.fromJSDate(new Date(value), true);
  if (!Number.isFinite(time.toJSDate().getTime())) throw new Error('Enter a valid event date.');
  const existing = component.getFirstProperty(name);
  if (existing) {
    existing.removeParameter('tzid');
    existing.removeParameter('value');
  }
  component.updatePropertyWithValue(name, time);
  if (allDay) component.getFirstProperty(name)?.setParameter('value', 'date');
}

function updateCalendarObjectData(object, changes) {
  const parsed = new ICAL.Component(ICAL.parse(object.data));
  const payload = decodeEventId(changes.eventId);
  const component = parsed
    .getAllSubcomponents('vevent')
    .find((item) => {
      const uid = item.getFirstPropertyValue('uid');
      const recurrence = item.getFirstPropertyValue('recurrence-id');
      return String(uid || '') === payload.uid && String(recurrence || '') === payload.recurrenceId;
    });
  if (!component) throw new Error('The calendar event no longer exists. Refresh and try again.');
  const event = changes.event && typeof changes.event === 'object' ? changes.event : {};
  const current = new ICAL.Event(component);

  if (Object.prototype.hasOwnProperty.call(event, 'summary')) {
    updateComponentValue(component, 'summary', event.summary);
  }
  if (Object.prototype.hasOwnProperty.call(event, 'description')) {
    updateComponentValue(component, 'description', event.description || '');
  }
  if (Object.prototype.hasOwnProperty.call(event, 'location')) {
    updateComponentValue(component, 'location', event.location || '');
  }

  const hasStart =
    Object.prototype.hasOwnProperty.call(event, 'start_date') ||
    Object.prototype.hasOwnProperty.call(event, 'start_date_time');
  const hasEnd =
    Object.prototype.hasOwnProperty.call(event, 'end_date') ||
    Object.prototype.hasOwnProperty.call(event, 'end_date_time');
  if (hasStart || hasEnd) {
    const allDay =
      Object.prototype.hasOwnProperty.call(event, 'start_date') ||
      Object.prototype.hasOwnProperty.call(event, 'end_date') ||
      (!Object.prototype.hasOwnProperty.call(event, 'start_date_time') &&
        !Object.prototype.hasOwnProperty.call(event, 'end_date_time') &&
        current.startDate.isDate);
    const currentStart = timeValue(current.startDate);
    const currentEnd = timeValue(current.endDate);
    const asMode = (value) => {
      if (allDay) return value.includes('T') ? value.slice(0, 10) : value;
      return value.includes('T') ? value : `${value}T00:00:00.000Z`;
    };
    let start = asMode(
      allDay
        ? event.start_date || event.start_date_time || currentStart
        : event.start_date_time || event.start_date || currentStart,
    );
    let end = asMode(
      allDay
        ? event.end_date || event.end_date_time || currentEnd
        : event.end_date_time || event.end_date || currentEnd,
    );

    // A drag-reschedule sends only a new start and should keep the original
    // duration. Explicit start/end edits continue to use the supplied range.
    if (hasStart && !hasEnd) {
      const delta = new Date(start).getTime() - new Date(asMode(currentStart)).getTime();
      if (allDay) {
        end = new Date(new Date(asMode(currentEnd)).getTime() + delta).toISOString().slice(0, 10);
      } else {
        end = new Date(new Date(asMode(currentEnd)).getTime() + delta).toISOString();
      }
    }

    normalizeEventInput({
      summary: event.summary ?? current.summary,
      ...(allDay ? { start_date: start, end_date: end } : { start_date_time: start, end_date_time: end }),
    });
    updateComponentTime(component, 'dtstart', start, allDay);
    updateComponentTime(component, 'dtend', end, allDay);
  }

  if (typeof event.rrule === 'string' && event.rrule.trim()) {
    component.updatePropertyWithValue('rrule', ICAL.Recur.fromString(event.rrule.trim()));
  }
  return parsed.toString();
}

function createCaldavCalendarService(options = {}) {
  const getSources = options.getSources || (() => []);
  const makeClient =
    options.makeClient ||
    ((source) =>
      createDAVClient({
        serverUrl: source.url,
        credentials: { username: source.username, password: source.password },
        authMethod: 'Basic',
        defaultAccountType: 'caldav',
        fetch: options.fetch,
      }));
  const clients = new Map();
  const calendarCache = new Map();

  function sourceById(sourceId) {
    const source = getSources().find((item) => item.id === sourceId && item.provider === 'caldav');
    if (!source || !source.url || !source.username || !source.password) {
      throw new Error('CalDAV account is incomplete. Save its server URL, username, and password first.');
    }
    return source;
  }

  async function clientFor(source) {
    const key = JSON.stringify([source.id, source.url, source.username, source.password]);
    let cached = clients.get(source.id);
    if (cached?.key !== key) {
      clients.delete(source.id);
      calendarCache.delete(source.id);
      cached = { key, client: await makeClient(source) };
      clients.set(source.id, cached);
    }
    return cached.client;
  }

  async function calendarsForSource(source, { force = false } = {}) {
    const cached = calendarCache.get(source.id);
    if (!force && cached && cached.key === JSON.stringify([source.id, source.url, source.username, source.password]) && cached.expiresAt > Date.now()) {
      return cached.calendars;
    }
    const client = await clientFor(source);
    const calendars = (await client.fetchCalendars()).map((calendar) => ({
      id: calendarId(source.id, calendar.url),
      name: `${source.name}: ${
        typeof calendar.displayName === 'string' && calendar.displayName.trim()
          ? calendar.displayName.trim()
          : new URL(calendar.url).pathname.split('/').filter(Boolean).pop() || source.name
      }`,
      url: calendar.url,
      sourceId: source.id,
      sourceName: source.name,
      provider: 'caldav',
    }));
    calendarCache.set(source.id, {
      key: JSON.stringify([source.id, source.url, source.username, source.password]),
      calendars,
      expiresAt: Date.now() + CALENDAR_CACHE_TTL_MS,
    });
    return calendars;
  }

  async function resolveCalendar(id) {
    const { sourceId, calendarUrl } = decodeCalendarId(id);
    const source = sourceById(sourceId);
    const calendars = await calendarsForSource(source);
    const calendar = calendars.find((item) => item.url === calendarUrl);
    if (!calendar) throw new Error('The CalDAV calendar is no longer available. Refresh the calendar list.');
    return { source, calendar, client: await clientFor(source) };
  }

  return {
    async testSource(source) {
      if (!source || typeof source !== 'object' || source.provider !== 'caldav') {
        throw new Error('Choose CalDAV as the calendar source type.');
      }
      if (!source.url || !source.username || !source.password) {
        throw new Error('Enter the CalDAV server URL, username, and password.');
      }
      const calendars = await calendarsForSource(source, { force: true });
      return { calendars: calendars.map(({ id, name }) => ({ id, name })), calendarCount: calendars.length };
    },

    async listCalendars() {
      const sources = getSources().filter((source) => source.provider === 'caldav');
      const results = await Promise.allSettled(sources.map((source) => calendarsForSource(source)));
      return results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    },

    async fetchEvents(id, start, end) {
      const { calendar, client } = await resolveCalendar(id);
      const objects = await client.fetchCalendarObjects({
        calendar,
        timeRange: { start, end },
        expand: true,
        urlFilter: () => true,
      });
      return objects.flatMap((object) => parseCalendarObject(object, calendar));
    },

    async createEvent(id, value) {
      const { calendar, client } = await resolveCalendar(id);
      const event = normalizeEventInput(value);
      const uid = randomUUID();
      const response = await client.createCalendarObject({
        calendar,
        filename: `${uid}.ics`,
        iCalString: buildCalendarObject(event, uid),
      });
      if (!response.ok) throw new Error(`CalDAV rejected the new event (HTTP ${response.status}).`);
      return { ok: true };
    },

    async updateEvent(id, eventId, value) {
      const { calendar, client } = await resolveCalendar(id);
      const payload = decodeEventId(eventId);
      if (payload.recurrenceId) {
        throw new Error('Editing one occurrence of a recurring CalDAV event is not supported yet.');
      }
      const url = new URL(payload.url);
      const collection = new URL(calendar.url);
      const collectionPath = collection.pathname.endsWith('/')
        ? collection.pathname
        : `${collection.pathname}/`;
      if (url.origin !== collection.origin || !url.pathname.startsWith(collectionPath)) {
        throw new Error('The event does not belong to the selected CalDAV calendar.');
      }
      const [object] = await client.fetchCalendarObjects({
        calendar,
        objectUrls: [payload.url],
        urlFilter: () => true,
      });
      if (!object || typeof object.data !== 'string') {
        throw new Error('The calendar event no longer exists. Refresh and try again.');
      }
      const response = await client.updateCalendarObject({
        calendarObject: {
          ...object,
          url: payload.url,
          data: updateCalendarObjectData(object, { eventId, event: value }),
        },
      });
      if (!response.ok) throw new Error(`CalDAV rejected the event update (HTTP ${response.status}).`);
      return { ok: true };
    },

    async deleteEvent(id, eventId) {
      const { calendar, client } = await resolveCalendar(id);
      const payload = decodeEventId(eventId);
      if (payload.recurrenceId) {
        throw new Error('Deleting one occurrence of a recurring CalDAV event is not supported yet.');
      }
      const url = new URL(payload.url);
      const collection = new URL(calendar.url);
      const collectionPath = collection.pathname.endsWith('/')
        ? collection.pathname
        : `${collection.pathname}/`;
      if (url.origin !== collection.origin || !url.pathname.startsWith(collectionPath)) {
        throw new Error('The event does not belong to the selected CalDAV calendar.');
      }
      const response = await client.deleteCalendarObject({
        calendarObject: { url: payload.url },
      });
      if (!response.ok) throw new Error(`CalDAV rejected the event deletion (HTTP ${response.status}).`);
      return { ok: true };
    },
  };
}

module.exports = { createCaldavCalendarService, calendarId, parseCalendarObject, buildCalendarObject };
