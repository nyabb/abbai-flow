import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deleteScreenSaverPhotos,
  listScreenSaverPhotos,
  screenSaverPhotoUrl,
  uploadScreenSaverPhoto,
  type SavedScreenSaverPhoto,
} from './screensaver-photos';

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

describe('screen saver photo requests', () => {
  it('lists saved photos under the current application base path', async () => {
    const photos: SavedScreenSaverPhoto[] = [
      { id: 'photo-1', name: 'Family.jpg', createdAt: '2026-11-26T12:00:00.000Z' },
    ];
    window.__ABBAI_FLOW_CONFIG__ = { deployment_mode: 'standalone' };
    window.history.replaceState({}, '', '/household/');
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ photos }));
    vi.stubGlobal('fetch', fetcher);

    await expect(listScreenSaverPhotos()).resolves.toEqual(photos);
    expect(fetcher).toHaveBeenCalledWith('/household/abbai-flow/photos', { cache: 'no-store' });
    expect(screenSaverPhotoUrl('photo/1')).toBe('/household/abbai-flow/photos/photo%2F1');
  });

  it('returns an empty list when the response has no photos field', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetcher);

    await expect(listScreenSaverPhotos()).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledWith('/abbai-flow/photos', { cache: 'no-store' });
  });

  it('uploads a photo as JSON and returns the saved photo', async () => {
    const photo: SavedScreenSaverPhoto = {
      id: 'photo-2', name: 'Holiday.png', createdAt: '2026-11-26T13:00:00.000Z',
    };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ photo }));
    vi.stubGlobal('fetch', fetcher);

    await expect(uploadScreenSaverPhoto('Holiday.png', 'data:image/png;base64,abc'))
      .resolves.toEqual(photo);
    expect(fetcher).toHaveBeenCalledWith('/abbai-flow/photos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Holiday.png', dataUrl: 'data:image/png;base64,abc' }),
    });
  });

  it('deletes one photo through its encoded resource URL', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ deletedCount: 1 }));
    vi.stubGlobal('fetch', fetcher);

    await expect(deleteScreenSaverPhotos(['photo/1'])).resolves.toBe(1);
    expect(fetcher).toHaveBeenCalledWith('/abbai-flow/photos/photo%2F1', { method: 'DELETE' });
  });

  it('posts empty and multiple selections to the bulk delete endpoint', async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ deletedCount: 0 }))
      .mockResolvedValueOnce(jsonResponse({ deletedCount: 0 }))
      .mockResolvedValueOnce(jsonResponse({ deletedCount: 2 }));
    vi.stubGlobal('fetch', fetcher);

    await expect(deleteScreenSaverPhotos([])).resolves.toBe(0);
    await expect(deleteScreenSaverPhotos([''])).resolves.toBe(0);
    await expect(deleteScreenSaverPhotos(['photo-1', 'photo-2'])).resolves.toBe(2);
    expect(fetcher).toHaveBeenNthCalledWith(1, '/abbai-flow/photos/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [] }),
    });
    expect(fetcher).toHaveBeenNthCalledWith(2, '/abbai-flow/photos/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: [''] }),
    });
    expect(fetcher).toHaveBeenNthCalledWith(3, '/abbai-flow/photos/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: ['photo-1', 'photo-2'] }),
    });
  });

  it('uses the server error message when a request fails', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ error: 'Photo limit reached.' }, 400),
    ));

    await expect(listScreenSaverPhotos()).rejects.toThrow('Photo limit reached.');
  });

  it('falls back to the HTTP status when an error response is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValue(new Response('not json', { status: 503 })));

    await expect(listScreenSaverPhotos()).rejects.toThrow(
      'Photo library request failed (HTTP 503).',
    );
  });
});
