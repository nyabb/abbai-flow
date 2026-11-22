import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
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

function renderPanel(state: EncoreSnapshot, loading = false) {
  return render(
    <I18nContext.Provider value={EN}>
      <SpotifyMusicPanel
        snapshot={state}
        loading={loading}
        onControl={vi.fn(async () => ({ ok: true }))}
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
});
