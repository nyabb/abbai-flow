import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  authenticateICloudReminders,
  fetchICloudRemindersTaskLists,
} from './integration-settings';

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete window.__ABBAI_FLOW_CONFIG__;
  window.history.replaceState({}, '', '/');
});

describe('iCloud Reminders settings requests', () => {
  it('posts authentication to the server endpoint under the current base path', async () => {
    window.__ABBAI_FLOW_CONFIG__ = { deployment_mode: 'standalone' };
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
});
