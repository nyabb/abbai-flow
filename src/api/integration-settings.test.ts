import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateICloudReminders,
  clearICloudRemindersCache,
  fetchICloudRemindersList,
  fetchICloudRemindersTaskLists,
  getCachedICloudRemindersList,
  loadICloudRemindersLists,
  updateICloudReminder,
} from './integration-settings';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearICloudRemindersCache();
  delete window.__ABBAI_FLOW_CONFIG__;
  window.history.replaceState({}, '', '/');
});

describe('iCloud Reminders settings requests', () => {
  it('posts authentication to the server endpoint under the current base path', async () => {
    window.__ABBAI_FLOW_CONFIG__ = {};
    window.history.replaceState({}, '', '/household/');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ ok: true, state: 'verification_required' }));
    vi.stubGlobal('fetch', fetcher);

    const result = await authenticateICloudReminders();

    expect(result.state).toBe('verification_required');
    expect(fetcher).toHaveBeenCalledWith(
      '/household/abbai-flow/settings/icloud-reminders/authenticate',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('rejects an HTML app-shell response instead of treating HTTP 200 as success', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('<html></html>', {
        status: 200,
        headers: { 'Content-Type': 'text/html' },
      }),
    );
    vi.stubGlobal('fetch', fetcher);

    await expect(authenticateICloudReminders()).rejects.toThrow(
      'The integration server returned a non-JSON response.',
    );
  });

  it('requests selected task lists with their known revisions', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ ok: true, state: 'unchanged', changed: false, revisions: { abc: 4 } }),
    );
    vi.stubGlobal('fetch', fetcher);

    const result = await fetchICloudRemindersTaskLists(['abc'], { abc: 4 });

    expect(result.changed).toBe(false);
    expect(fetcher).toHaveBeenCalledWith(
      '/abbai-flow/settings/icloud-reminders/task-lists',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ listKeys: ['abc'], revisions: { abc: 4 } }),
      }),
    );
  });

  it('keeps fetched list snapshots in memory and uses their revision for checks', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        state: 'fetched',
        revision: 7,
        lists: [{
          key: 'abc', title: 'Tasks', scope: 'private', deleted: false,
          isGroup: false, count: 1, reminders: [], sections: [],
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, state: 'unchanged', changed: false, revision: 7 }));
    vi.stubGlobal('fetch', fetcher);

    await fetchICloudRemindersList('abc');
    expect(getCachedICloudRemindersList('abc')?.revision).toBe(7);
    await fetchICloudRemindersList('abc');

    expect(fetcher.mock.calls[0][1]?.body).toBe(JSON.stringify({ listKey: 'abc', revision: undefined }));
    expect(fetcher.mock.calls[1][1]?.body).toBe(JSON.stringify({ listKey: 'abc', revision: 7 }));
    expect(getCachedICloudRemindersList('abc')?.revision).toBe(7);
  });

  it('rejects failed iCloud action payloads and exposes their error', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: 'A reminder title is required.', code: 'invalid_request' }, 400),
    ));

    await expect(loadICloudRemindersLists()).rejects.toThrow('A reminder title is required.');
  });

  it('preserves cached section placement when an update response omits section fields', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        state: 'fetched',
        revision: 7,
        lists: [{
          key: 'abc', title: 'Shopping', scope: 'private', deleted: false,
          isGroup: false, count: 1, sections: [{ id: 'S1', name: 'Produce', order: 0 }],
          reminders: [{ id: 'Reminder/R1', list_id: 'List/1', title: 'Milk',
            desc: '', completed: false, completed_date: null, due_date: null,
            start_date: null, priority: 0, flagged: false, all_day: false,
            deleted: false, sectionID: 'S1', sectionName: 'Produce', sectionOrder: 0 }],
        }],
      }))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        state: 'updated',
        revision: 8,
        reminder: { id: 'Reminder/R1', list_id: 'List/1', title: 'Milk',
          desc: '', completed: true, completed_date: null, due_date: null,
          start_date: null, priority: 0, flagged: false, all_day: false,
          deleted: false },
      }));
    vi.stubGlobal('fetch', fetcher);

    await fetchICloudRemindersList('abc');
    await updateICloudReminder('abc', 'Reminder/R1', { completed: true });

    expect(getCachedICloudRemindersList('abc')?.reminders?.[0]).toMatchObject({
      completed: true,
      sectionID: 'S1',
      sectionName: 'Produce',
      sectionOrder: 0,
    });
    expect(getCachedICloudRemindersList('abc')?.revision).toBe(8);
  });
});
