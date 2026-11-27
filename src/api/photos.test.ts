import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getPhotos } from './photos';
import { listScreenSaverPhotos, screenSaverPhotoUrl } from './screensaver-photos';

vi.mock('./screensaver-photos', () => ({
  listScreenSaverPhotos: vi.fn(),
  screenSaverPhotoUrl: vi.fn(),
}));

const mockListScreenSaverPhotos = vi.mocked(listScreenSaverPhotos);
const mockScreenSaverPhotoUrl = vi.mocked(screenSaverPhotoUrl);

describe('getPhotos', () => {
  beforeEach(() => {
    mockListScreenSaverPhotos.mockReset();
    mockScreenSaverPhotoUrl.mockReset();
  });

  it('includes uploaded screen saver photos with their saved captions and dates', async () => {
    mockListScreenSaverPhotos.mockResolvedValue([
      { id: 'photo-1', name: 'Family.jpg', createdAt: '2026-11-26T12:00:00.000Z' },
    ]);
    mockScreenSaverPhotoUrl.mockReturnValue('/abbai-flow/photos/photo-1');

    const photos = await getPhotos(['uploaded']);

    expect(photos).toEqual([
      {
        url: '/abbai-flow/photos/photo-1',
        caption: 'Family.jpg',
        date: '2026-11-26T12:00:00.000Z',
        source: 'uploaded',
      },
    ]);
    expect(mockScreenSaverPhotoUrl).toHaveBeenCalledWith('photo-1');
  });

  it('keeps screen saver photos optional when the library request fails', async () => {
    mockListScreenSaverPhotos.mockRejectedValue(new Error('server unavailable'));
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    await expect(getPhotos(['uploaded'])).resolves.toEqual([]);
  });
});
