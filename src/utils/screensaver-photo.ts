const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 1600;
const JPEG_QUALITY = 0.84;

function loadImage(source: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Could not read that image file.'));
    image.src = source;
  });
}

/** Resize an uploaded photo before sending it to the device photo library. */
export async function imageFileToScreenSaverDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/') || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Choose an image under 20 MB.');
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
    if (!context) throw new Error('Image resizing is not available in this browser.');
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
