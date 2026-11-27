/**
 * Family member photos.
 *
 * Member photos are saved as data URLs or explicit image URLs.
 */

/** Uploads are downscaled to this longest edge — plenty for a wall display. */
const MAX_EDGE = 256;
const JPEG_QUALITY = 0.82;
const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;

export function isSupportedImageFile(file: File): boolean {
  return file.type.startsWith('image/') && file.size > 0 && file.size <= MAX_UPLOAD_BYTES;
}

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read that image file'));
    image.src = source;
  });
}

/**
 * Read an uploaded file into a downscaled JPEG data URL, so photos survive
 * offline in localStorage instead of costing a network round trip.
 */
export async function imageFileToDataUrl(file: File): Promise<string> {
  if (!isSupportedImageFile(file)) {
    throw new Error('Unsupported image — use a PNG, JPEG or WebP under 12 MB.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(objectUrl);
    const scale = Math.min(1, MAX_EDGE / Math.max(image.width, image.height));
    const width = Math.max(1, Math.round(image.width * scale));
    const height = Math.max(1, Math.round(image.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image editing is not available in this browser');

    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

/** Turn a stored photo reference into something an `<img>` can load. */
export function resolveMemberPhoto(photo: string): string {
  return photo;
}
