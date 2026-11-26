import { getRuntimeConfig } from '../config';

const COLLECTION_PATH = '/abbai-flow/photos';

export interface SavedScreenSaverPhoto {
  id: string;
  name: string;
  createdAt: string;
}

function basePath(): string {
  return getRuntimeConfig() ? window.location.pathname.replace(/\/$/u, '') : '';
}

function endpoint(path: string): string {
  return `${basePath()}${path}`;
}

async function readResponse<T>(response: Response): Promise<T> {
  const value = (await response.json().catch(() => ({}))) as { error?: string } & T;
  if (!response.ok) {
    throw new Error(value.error || `Photo library request failed (HTTP ${response.status}).`);
  }
  return value;
}

export function screenSaverPhotoUrl(id: string): string {
  return endpoint(`${COLLECTION_PATH}/${encodeURIComponent(id)}`);
}

export async function listScreenSaverPhotos(): Promise<SavedScreenSaverPhoto[]> {
  const response = await fetch(endpoint(COLLECTION_PATH), { cache: 'no-store' });
  const result = await readResponse<{ photos: SavedScreenSaverPhoto[] }>(response);
  return result.photos || [];
}

export async function uploadScreenSaverPhoto(
  name: string,
  dataUrl: string,
): Promise<SavedScreenSaverPhoto> {
  const response = await fetch(endpoint(COLLECTION_PATH), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, dataUrl }),
  });
  const result = await readResponse<{ photo: SavedScreenSaverPhoto }>(response);
  return result.photo;
}

export async function deleteScreenSaverPhotos(ids: string[]): Promise<number> {
  const [onlyId] = ids;
  if (ids.length === 1 && onlyId) {
    const response = await fetch(screenSaverPhotoUrl(onlyId), { method: 'DELETE' });
    const result = await readResponse<{ deletedCount: number }>(response);
    return result.deletedCount;
  }
  const response = await fetch(endpoint(`${COLLECTION_PATH}/delete`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const result = await readResponse<{ deletedCount: number }>(response);
  return result.deletedCount;
}
