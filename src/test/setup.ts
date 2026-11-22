import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Ensure a clean DOM + localStorage between tests so state doesn't leak
// across cases (this repo's localStorage-backed persistence layer makes
// that an easy trap otherwise — see abbai-flow-store.ts / secure-storage.ts).
// localStorage is guarded here because some jsdom/Node combinations don't
// expose a fully functional global until the DOM environment settles.
afterEach(() => {
  cleanup();
  try {
    globalThis.localStorage?.clear();
  } catch {
    /* localStorage unavailable in this test environment — ignore */
  }
});
