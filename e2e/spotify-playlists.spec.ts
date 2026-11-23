import { expect, test, type Page } from '@playwright/test';
import { startStack, type E2EStack } from './stack';

const PLAYLIST_ID = '4q3zB8nVYk9m2H6wX1cR0P';

const PLAYLIST = {
  id: PLAYLIST_ID,
  uri: `spotify:playlist:${PLAYLIST_ID}`,
  name: 'Summer mix',
  artworkUrl: null,
  spotifyUrl: `https://open.spotify.com/playlist/${PLAYLIST_ID}`,
  ownerName: 'Abbai',
  trackCount: 1,
  isPublic: false,
};

let stack: E2EStack;

test.beforeAll(async () => {
  stack = await startStack();
});

test.afterAll(async () => {
  await stack.close();
});

async function mockSpotify(page: Page) {
  let playlistRemoved = false;
  await page.addInitScript(() => {
    class StubEventSource extends EventTarget {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSED = 2;
      readyState = StubEventSource.OPEN;

      close() {
        this.readyState = StubEventSource.CLOSED;
      }
    }
    Object.defineProperty(window, 'EventSource', {
      configurable: true,
      value: StubEventSource,
    });
  });

  await page.route('**/abbai-flow/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();

    if (url.pathname === '/abbai-flow/music/state') {
      await route.fulfill({
        json: {
          configured: true,
          connection: 'connected',
          auth: { loggedIn: true, isActive: true, deviceName: 'Abbai Party' },
          playback: {
            status: 'paused',
            item: null,
            context: null,
            position: null,
            volume: 35,
            options: { shuffle: false, repeat: 'off' },
            availableActions: ['play', 'pause', 'next', 'previous', 'volume'],
          },
          queue: { previous: [], upcoming: [] },
          error: null,
          updatedAt: 1,
        },
      });
      return;
    }
    if (url.pathname === '/abbai-flow/music/library/status') {
      await route.fulfill({
        json: {
          configured: true,
          credentialsConfigured: true,
          authorized: true,
          redirectConfigured: true,
        },
      });
      return;
    }
    if (url.pathname === '/abbai-flow/music/library/playlists' && method === 'GET') {
      const items = playlistRemoved ? [] : [PLAYLIST];
      await route.fulfill({ json: { items, total: items.length, offset: 0 } });
      return;
    }
    if (url.pathname === `/abbai-flow/music/library/playlists/${PLAYLIST_ID}` && method === 'DELETE') {
      playlistRemoved = true;
      await route.fulfill({ status: 202, json: { accepted: true } });
      return;
    }
    if (url.pathname === `/abbai-flow/music/library/playlists/${PLAYLIST_ID}/items`) {
      await route.fulfill({ json: { items: [], total: 0, offset: 0 } });
      return;
    }
    if (url.pathname === '/abbai-flow/music/search') {
      await route.fulfill({
        json: {
          tracks: [
            {
              uri: 'spotify:track:abc123',
              title: 'Sample Song',
              artists: ['Sample Artist'],
              album: 'Sample Album',
              artworkUrl: null,
              spotifyUrl: null,
              durationMs: 180000,
            },
          ],
        },
      });
      return;
    }
    if (url.pathname === '/abbai-flow/bluetooth/state') {
      await route.fulfill({
        json: {
          configured: false,
          connection: 'disabled',
          adapter: null,
          scanning: false,
          devices: [],
          challenge: null,
          notice: null,
          error: null,
          updatedAt: 1,
        },
      });
      return;
    }
    await route.continue();
  });
}

async function openMusic(page: Page) {
  await page.goto(stack.appUrl);
  const mobileNavigation = page.locator('.mobile-tab-bar');
  if (await mobileNavigation.isVisible()) {
    await mobileNavigation.getByRole('button', { name: 'Music', exact: true }).click();
    return;
  }
  await page
    .locator('.sidebar--desktop')
    .getByRole('button', { name: 'Music', exact: true })
    .click();
}

test('mobile add-to-playlist picker stays visible in normal flow above the library', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockSpotify(page);
  await openMusic(page);

  await page.getByRole('heading', { name: 'Your Library' }).waitFor();
  await page.getByRole('searchbox', { name: 'Search Spotify' }).fill('Sample Song');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Add to playlist: Sample Song' }).click();

  const picker = page.getByRole('group', { name: 'Add to playlist' });
  await expect(picker).toBeVisible();
  await picker.scrollIntoViewIfNeeded();
  await expect(picker).toBeInViewport();
  await expect(picker.getByRole('button', { name: 'Summer mix' })).toBeVisible();

  const pickerBounds = await picker.boundingBox();
  const libraryBounds = await page.locator('.spotify-library').boundingBox();
  expect(pickerBounds).not.toBeNull();
  expect(libraryBounds).not.toBeNull();
  expect(pickerBounds!.y + pickerBounds!.height).toBeLessThanOrEqual(libraryBounds!.y);
});

test('playlist removal confirmation removes the selected list from the UI', async ({ page }) => {
  await mockSpotify(page);
  await openMusic(page);
  await expect(page.getByRole('heading', { name: 'Summer mix' })).toBeVisible();

  page.on('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Remove playlist' }).click();

  await expect(page.getByRole('heading', { name: 'Summer mix' })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Choose a playlist' })).toBeVisible();
});
