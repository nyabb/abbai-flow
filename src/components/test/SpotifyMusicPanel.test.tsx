import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { waitFor } from '@testing-library/react';
import { I18nContext, createI18n } from '../../i18n';
import type { EncoreSnapshot } from '../../api/encore-music';
import { SpotifyMusicPanel } from '../SpotifyMusicPanel';

const EN = createI18n('en-US');

function snapshot(overrides: Partial<EncoreSnapshot> = {}): EncoreSnapshot {
  return {
    configured: true,
    connection: 'disconnected',
    auth: { loggedIn: null, isActive: null, deviceName: null },
    playback: {
      status: 'idle',
      item: null,
      context: null,
      position: null,
      volume: null,
      options: { shuffle: null, repeat: null },
      availableActions: [],
    },
    queue: { previous: [], upcoming: [] },
    error: null,
    updatedAt: 1,
    ...overrides,
  };
}

function renderPanel(
  state: EncoreSnapshot,
  loading = false,
  onSearch = vi.fn(async () => ({ tracks: [] })),
) {
  return render(
    <I18nContext.Provider value={EN}>
      <SpotifyMusicPanel
        snapshot={state}
        loading={loading}
        onControl={vi.fn(async () => ({ ok: true }))}
        onSearch={onSearch}
      />
    </I18nContext.Provider>,
  );
}

describe('SpotifyMusicPanel connection states', () => {
  it('shows a connecting state while the initial server request is pending', () => {
    renderPanel(snapshot({ configured: false }), true);
    expect(screen.getByRole('status')).toHaveTextContent('Connecting...');
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });

  it('explains a disconnected Encore connection and disables playback controls', () => {
    renderPanel(snapshot({ connection: 'disconnected', error: 'Encore connection lost' }));
    expect(screen.getByRole('status')).toHaveTextContent('Abbai Flow unreachable');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Encore is unavailable. Abbai Flow will reconnect automatically.',
    );
    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });

  it('searches the catalog and plays a result through Encore', async () => {
    const onSearch = vi.fn(async () => ({
      tracks: [
        {
          uri: 'spotify:track:abc123',
          title: 'Sample Song',
          artists: ['Sample Artist'],
          album: 'Sample Album',
          artworkUrl: null,
          durationMs: 180000,
        },
      ],
    }));
    const onControl = vi.fn(async () => ({ ok: true }));
    const active = snapshot({
      connection: 'connected',
      auth: { loggedIn: true, isActive: true, deviceName: 'Abbai Party' },
    });
    render(
      <I18nContext.Provider value={EN}>
        <SpotifyMusicPanel
          snapshot={active}
          loading={false}
          onSearch={onSearch}
          onControl={onControl}
        />
      </I18nContext.Provider>,
    );

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Spotify' }), {
      target: { value: 'Sample Song' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByText('Sample Song')).toBeInTheDocument();
    expect(onSearch).toHaveBeenCalledWith('Sample Song');
    fireEvent.click(screen.getByRole('button', { name: 'Play track: Sample Song' }));
    await waitFor(() =>
      expect(onControl).toHaveBeenCalledWith('playTrack', 'spotify:track:abc123'),
    );
  });

  it('keeps search results visible but disables playback while disconnected', async () => {
    const onSearch = vi.fn(async () => ({
      tracks: [
        {
          uri: 'spotify:track:abc123',
          title: 'Sample Song',
          artists: ['Sample Artist'],
          album: 'Sample Album',
          artworkUrl: null,
          durationMs: null,
        },
      ],
    }));
    renderPanel(snapshot(), false, onSearch);

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Spotify' }), {
      target: { value: 'Sample Song' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));

    expect(await screen.findByRole('button', { name: 'Play track: Sample Song' })).toBeDisabled();
  });

  it('keeps mobile volume compact and exposes the slider when expanded', () => {
    renderPanel(snapshot());
    const volumeButton = screen.getByRole('button', { name: 'Volume' });

    expect(volumeButton).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(volumeButton);
    expect(volumeButton).toHaveAttribute('aria-expanded', 'true');
    expect(volumeButton).toHaveAttribute('aria-controls', 'spotify-volume');
  });
});
