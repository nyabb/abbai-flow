const fs = require('fs/promises');
const path = require('path');
const { randomBytes } = require('crypto');

const MAX_PHOTOS = 50;
const MAX_PHOTO_BYTES = 6 * 1024 * 1024;
const PHOTO_ID_PATTERN = /^[a-f0-9]{32}$/u;

class PhotoLibraryError extends Error {
  constructor(status, message) {
    super(message);
    this.name = 'PhotoLibraryError';
    this.status = status;
  }
}

function parsePhotoDataUrl(value) {
  if (typeof value !== 'string') {
    throw new PhotoLibraryError(400, 'Choose an image to upload.');
  }
  const match = value.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/u);
  if (!match) throw new PhotoLibraryError(400, 'Upload a JPEG photo.');

  const bytes = Buffer.from(match[1], 'base64');
  if (!bytes.length || bytes.toString('base64') !== match[1]) {
    throw new PhotoLibraryError(400, 'The uploaded photo is not valid.');
  }
  if (bytes.length > MAX_PHOTO_BYTES) {
    throw new PhotoLibraryError(413, 'The resized photo is too large to store.');
  }
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    throw new PhotoLibraryError(400, 'The uploaded file is not a valid JPEG image.');
  }
  return bytes;
}

function cleanName(value) {
  if (typeof value !== 'string') return 'Photo';
  const basename = value.replaceAll('\\', '/').split('/').pop() || '';
  const name = Array.from(basename)
    .filter((character) => {
      const code = character.codePointAt(0) || 0;
      return code >= 0x20 && code !== 0x7f;
    })
    .join('')
    .trim();
  return Array.from(name).slice(0, 120).join('') || 'Photo';
}

function createScreenSaverPhotoLibrary({ dataDir }) {
  const directory = path.join(dataDir || '/data', 'screensaver-photos');
  const indexPath = path.join(directory, 'index.json');
  let writes = Promise.resolve();

  function serialized(operation) {
    const result = writes.then(operation, operation);
    writes = result.catch(() => undefined);
    return result;
  }

  async function readIndex() {
    try {
      const raw = await fs.readFile(indexPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('invalid photo index');
      return parsed
        .filter(
          (item) =>
            item &&
            typeof item === 'object' &&
            PHOTO_ID_PATTERN.test(item.id) &&
            typeof item.name === 'string' &&
            typeof item.createdAt === 'string',
        )
        .slice(0, MAX_PHOTOS);
    } catch (error) {
      if (error && error.code === 'ENOENT') return [];
      throw new PhotoLibraryError(500, 'Could not read the saved photo list.');
    }
  }

  async function writeIndex(items) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${indexPath}.${randomBytes(8).toString('hex')}.tmp`;
    try {
      await fs.writeFile(temporaryPath, JSON.stringify(items), { mode: 0o600 });
      await fs.rename(temporaryPath, indexPath);
    } catch {
      await fs.unlink(temporaryPath).catch(() => undefined);
      throw new PhotoLibraryError(500, 'Could not save the photo list.');
    }
  }

  return {
    async list() {
      return readIndex();
    },

    async read(id) {
      if (!PHOTO_ID_PATTERN.test(String(id))) {
        throw new PhotoLibraryError(404, 'Photo not found.');
      }
      try {
        return await fs.readFile(path.join(directory, `${id}.jpg`));
      } catch (error) {
        if (error && error.code === 'ENOENT') {
          throw new PhotoLibraryError(404, 'Photo not found.');
        }
        throw new PhotoLibraryError(500, 'Could not read the saved photo.');
      }
    },

    async add({ name, dataUrl }) {
      const bytes = parsePhotoDataUrl(dataUrl);
      return serialized(async () => {
        const items = await readIndex();
        if (items.length >= MAX_PHOTOS) {
          throw new PhotoLibraryError(409, `You can save up to ${MAX_PHOTOS} photos.`);
        }
        await fs.mkdir(directory, { recursive: true, mode: 0o700 });
        const id = randomBytes(16).toString('hex');
        const item = { id, name: cleanName(name), createdAt: new Date().toISOString() };
        const filePath = path.join(directory, `${id}.jpg`);
        try {
          await fs.writeFile(filePath, bytes, { flag: 'wx', mode: 0o600 });
          await writeIndex([...items, item]);
        } catch (error) {
          await fs.unlink(filePath).catch(() => undefined);
          if (error instanceof PhotoLibraryError) throw error;
          throw new PhotoLibraryError(500, 'Could not save the uploaded photo.');
        }
        return item;
      });
    },

    async remove(ids) {
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_PHOTOS) {
        throw new PhotoLibraryError(400, 'Select one or more saved photos to delete.');
      }
      const uniqueIds = [...new Set(ids)];
      if (uniqueIds.some((id) => typeof id !== 'string' || !PHOTO_ID_PATTERN.test(id))) {
        throw new PhotoLibraryError(400, 'The selected photo list is invalid.');
      }
      return serialized(async () => {
        const items = await readIndex();
        const removing = new Set(uniqueIds);
        const remaining = items.filter((item) => !removing.has(item.id));
        await writeIndex(remaining);
        await Promise.all(
          uniqueIds.map((id) =>
            fs.unlink(path.join(directory, `${id}.jpg`)).catch((error) => {
              if (!error || error.code !== 'ENOENT') throw error;
            }),
          ),
        );
        return items.length - remaining.length;
      });
    },
  };
}

module.exports = { createScreenSaverPhotoLibrary, PhotoLibraryError, MAX_PHOTOS };
