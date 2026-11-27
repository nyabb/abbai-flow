import type { Photo, PhotoSource } from '../types/photos';
import { listScreenSaverPhotos, screenSaverPhotoUrl } from './screensaver-photos';

/**
 * Shuffles an array in place using Fisher-Yates.
 */
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function fetchUploadedPhotos(): Promise<Photo[]> {
  try {
    const photos = await listScreenSaverPhotos();
    return photos.map((photo) => ({
      url: screenSaverPhotoUrl(photo.id),
      caption: photo.name,
      date: photo.createdAt,
      source: 'uploaded' as const,
    }));
  } catch {
    console.warn('Abbai Flow: Failed to fetch uploaded screen saver photos');
    return [];
  }
}

/**
 * Gets all photos from configured sources, shuffled.
 */
export async function getPhotos(
  sources: PhotoSource[] = ['uploaded'],
): Promise<Photo[]> {
  const fetchers: Promise<Photo[]>[] = [];
  if (sources.includes('uploaded')) {
    fetchers.push(fetchUploadedPhotos());
  }

  const results = await Promise.all(fetchers);
  const allPhotos = results.flat();

  return shuffle(allPhotos);
}
