import { describe, it, expect } from 'vitest';
import { isDisplayUrl } from './display-route';

/**
 * Display Mode is opted into by URL, so the matcher has to be exact enough not
 * to hijack a normal page, yet tolerant of the suffixes people actually type
 * into a kiosk browser — and it must keep a Home Assistant ingress base path.
 */
const url = (pathname: string) => ({ pathname });

describe('isDisplayUrl', () => {
  it.each(['/display', '/display/', '/DISPLAY', '/api/hassio_ingress/abc/display'])(
    'matches %s',
    (path) => {
      expect(isDisplayUrl(url(path))).toBe(true);
    },
  );

  it.each(['/', '/dashboard', '/displaymode', '/display/more', '/'])(
    'does not match %s',
    (path) => {
      expect(isDisplayUrl(url(path))).toBe(false);
    },
  );
});
