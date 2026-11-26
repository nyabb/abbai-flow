const test = require('node:test');
const assert = require('node:assert/strict');
const { createCaldavCalendarService } = require('../build/caldav-calendar-bundle.js');

const calendarUrl = 'https://caldav.example.test/account/calendars/family/';
const objectUrl = `${calendarUrl}event-1.ics`;
const calendarObject = {
  url: objectUrl,
  etag: 'etag-1',
  data: [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:event-1',
    'DTSTART:20261126T100000Z',
    'DTEND:20261126T110000Z',
    'SUMMARY:Planning',
    'DESCRIPTION:Initial notes',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n'),
};

test('CalDAV service discovers calendars and supports event CRUD', async () => {
  const source = {
    id: 'apple-calendar',
    name: 'Apple',
    provider: 'caldav',
    url: 'https://caldav.example.test/',
    username: 'family@example.test',
    password: 'app-password',
  };
  const calls = [];
  let discoveryCalls = 0;
  let storedObject = { ...calendarObject };
  const client = {
    async fetchCalendars() {
      discoveryCalls += 1;
      return [{ url: calendarUrl, displayName: 'Family' }];
    },
    async fetchCalendarObjects(options) {
      calls.push({ method: 'fetchCalendarObjects', options });
      if (options.objectUrls) return [storedObject];
      return [storedObject];
    },
    async createCalendarObject(options) {
      calls.push({ method: 'createCalendarObject', options });
      return { ok: true, status: 201 };
    },
    async updateCalendarObject(options) {
      calls.push({ method: 'updateCalendarObject', options });
      storedObject = { ...storedObject, data: options.calendarObject.data };
      return { ok: true, status: 204 };
    },
    async deleteCalendarObject(options) {
      calls.push({ method: 'deleteCalendarObject', options });
      return { ok: true, status: 204 };
    },
  };
  const service = createCaldavCalendarService({
    getSources: () => [source],
    makeClient: async () => client,
  });

  const discovered = await service.testSource(source);
  assert.equal(discovered.calendarCount, 1);
  assert.equal(discovered.calendars[0].name, 'Apple: Family');
  assert.equal(discoveryCalls, 1);
  const [calendar] = await service.listCalendars();
  assert.equal(calendar.id, discovered.calendars[0].id);
  assert.equal(discoveryCalls, 1, 'reuses recent calendar discovery');

  const [event] = await service.fetchEvents(calendar.id, '2026-11-26T00:00:00Z', '2026-11-27T00:00:00Z');
  assert.equal(event.title, 'Planning');
  assert.equal(event.calendarName, 'Apple: Family');
  assert.equal(event.hasStableId, true);
  assert.equal(event.start, '2026-11-26T10:00:00.000Z');
  assert.equal(discoveryCalls, 1, 'event reads do not rediscover the calendar list');

  await service.createEvent(calendar.id, {
    summary: 'Lunch, family',
    start_date_time: '2026-11-27T12:00:00.000Z',
    end_date_time: '2026-11-27T13:00:00.000Z',
    description: 'Bring fruit',
  });
  const createCall = calls.find((call) => call.method === 'createCalendarObject');
  assert.match(createCall.options.iCalString, /SUMMARY:Lunch\\, family/u);
  assert.match(createCall.options.iCalString, /DESCRIPTION:Bring fruit/u);

  await service.updateEvent(calendar.id, event.id, { summary: 'Planning updated' });
  const summaryCall = calls.filter((call) => call.method === 'updateCalendarObject').at(-1);
  assert.match(summaryCall.options.calendarObject.data, /SUMMARY:Planning updated/u);
  assert.match(summaryCall.options.calendarObject.data, /DESCRIPTION:Initial notes/u);

  await service.updateEvent(calendar.id, event.id, {
    start_date_time: '2026-11-26T12:00:00.000Z',
  });
  const movedCall = calls.filter((call) => call.method === 'updateCalendarObject').at(-1);
  assert.match(movedCall.options.calendarObject.data, /DTSTART:20261126T120000Z/u);
  assert.match(movedCall.options.calendarObject.data, /DTEND:20261126T130000Z/u);

  await service.deleteEvent(calendar.id, event.id);
  assert.deepEqual(calls.at(-1), {
    method: 'deleteCalendarObject',
    options: { calendarObject: { url: objectUrl } },
  });
});

test('ICS feeds appear as read-only calendars and provide events for the selected range', async () => {
  const source = {
    id: 'school-feed',
    name: 'School',
    provider: 'ics',
    url: 'https://calendar.example.test/school.ics',
  };
  const feed = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:school-event',
    'DTSTART:20261126T100000Z',
    'DTEND:20261126T110000Z',
    'SUMMARY:Parent meeting',
    'DESCRIPTION:Room 2',
    'LOCATION:School',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:weekly-event',
    'DTSTART:20261119T120000Z',
    'DTEND:20261119T130000Z',
    'RRULE:FREQ=WEEKLY',
    'SUMMARY:Weekly assembly',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  const requestedUrls = [];
  const service = createCaldavCalendarService({
    getSources: () => [source],
    fetch: async (url) => {
      requestedUrls.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => feed,
      };
    },
  });

  const [calendar] = await service.listCalendars();
  assert.equal(calendar.name, 'School');
  assert.equal(calendar.provider, 'ics');
  assert.equal(calendar.readOnly, true);

  const verified = await service.testSource(source);
  assert.equal(verified.calendarCount, 1);
  assert.deepEqual(verified.calendars, [{ id: calendar.id, name: 'School' }]);

  const events = await service.fetchEvents(
    calendar.id,
    '2026-11-26T00:00:00Z',
    '2026-11-27T00:00:00Z',
  );
  assert.deepEqual(events.map((event) => event.title), ['Parent meeting', 'Weekly assembly']);
  assert.equal(events[0].description, 'Room 2');
  assert.equal(events[0].location, 'School');
  assert.equal(events[0].readOnly, true);
  assert.equal(events[1].start, '2026-11-26T12:00:00.000Z');
  assert.equal(requestedUrls.length, 2, 'feed is fetched for both connection test and event retrieval');
  await assert.rejects(() =>
    service.createEvent(calendar.id, {
      summary: 'Unsupported write',
      start_date_time: '2026-11-26T12:00:00.000Z',
      end_date_time: '2026-11-26T13:00:00.000Z',
    }),
  );
});
