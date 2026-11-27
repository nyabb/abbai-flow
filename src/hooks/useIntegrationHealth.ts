import { useCallback, useEffect, useState } from 'react';
import { getRuntimeConfig } from '../config';
import { loadIntegrationSettings, type IntegrationSettingsStatus } from '../api/integration-settings';
import type { SpotifyPlaylistStatus } from '../api/spotify-playlists';

export interface SettingsAttention {
  id: string;
  group: 'server' | 'spotify' | 'icloud' | 'calendar' | 'transient';
  field: string;
}

const READY_ICLOUD_STATES = new Set(['authenticated', 'verified_untrusted', 'fetched']);

function collectAttention(
  settings: IntegrationSettingsStatus,
  spotify: SpotifyPlaylistStatus,
): SettingsAttention[] {
  const attention: SettingsAttention[] = [];
  const add = (group: SettingsAttention['group'], field: string) => {
    attention.push({ id: `${group}:${field}`, group, field });
  };

  const spotifyStarted = Boolean(
    settings.spotifyClientId.trim() ||
      settings.spotifyClientSecretConfigured ||
      settings.spotifyRedirectUri.trim(),
  );
  if (spotifyStarted) {
    if (!settings.spotifyClientId.trim()) add('spotify', 'spotifyClientId');
    if (!settings.spotifyClientSecretConfigured) add('spotify', 'spotifyClientSecret');
    if (!settings.spotifyRedirectUri.trim() || !spotify.redirectConfigured) {
      add('spotify', 'spotifyRedirectUri');
    }
    if (
      settings.spotifyClientId.trim() &&
      settings.spotifyClientSecretConfigured &&
      settings.spotifyRedirectUri.trim() &&
      spotify.configured
    ) {
      if (!spotify.authorized) add('spotify', 'spotifyAccount');
      else if (spotify.playbackAuthorized === false) add('spotify', 'spotifyPlayback');
    }
  }

  const icloudStarted = Boolean(
    settings.icloudAppleId.trim() || settings.icloudPasswordConfigured || settings.icloudAuthState,
  );
  if (icloudStarted) {
    if (!settings.icloudAppleId.trim()) add('icloud', 'icloudAppleId');
    if (!settings.icloudPasswordConfigured) add('icloud', 'icloudPassword');
    if (
      settings.icloudAppleId.trim() &&
      settings.icloudPasswordConfigured &&
      settings.icloudAuthState !== 'authenticating' &&
      !READY_ICLOUD_STATES.has(settings.icloudAuthState)
    ) {
      add('icloud', 'icloudAuthentication');
    }
  }

  for (const source of settings.calendarSources) {
    const started = Boolean(
      source.name.trim() ||
        source.url.trim() ||
        source.username.trim() ||
        source.passwordConfigured ||
        source.clientId.trim() ||
        source.clientSecretConfigured,
    );
    if (!started) continue;
    const incomplete =
      source.provider === 'caldav'
        ? !source.url.trim() || !source.username.trim() || !source.passwordConfigured
        : source.provider === 'ics'
          ? !source.url.trim()
          : !source.clientId.trim() || !source.clientSecretConfigured;
    if (incomplete) add('calendar', `calendarSource:${source.id}`);
  }

  return attention;
}

/** Read saved integration status at the app shell so setup issues stay visible across views. */
export function useIntegrationHealth(
  revision: number,
  spotify: SpotifyPlaylistStatus,
): SettingsAttention[] {
  const [attention, setAttention] = useState<SettingsAttention[]>([]);
  const serverBacked = Boolean(getRuntimeConfig());

  const refresh = useCallback(async () => {
    if (!serverBacked) {
      setAttention([]);
      return;
    }
    try {
      const settings = await loadIntegrationSettings();
      setAttention(collectAttention(settings, spotify));
    } catch {
      setAttention([{ id: 'server:integrationSettings', group: 'server', field: 'integrationSettings' }]);
    }
  }, [serverBacked, spotify]);

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 60_000);
    return () => window.clearInterval(interval);
  }, [refresh, revision]);

  return attention;
}
