import { useState, useEffect, useRef, useCallback } from 'react';
import { HomeAssistantClient } from '../api/homeassistant';
import { getConfig, patchConfig } from '../config';
import { setHaToken } from '../api/ha-rest';
import { getSecureItem, StorageKeys } from '../api/secure-storage';
import { usesServerProxy, isIngress } from '../utils/ha-env';

function resolveHaUrl(): string {
  const config = getConfig();

  if (config.ha_url && !config.ha_url.includes('supervisor')) return config.ha_url;

  if (isIngress()) {
    try {
      return window.parent.location.origin;
    } catch {
      return window.location.origin;
    }
  }

  return window.location.origin;
}

/**
 * Request an access token from the HA frontend via the ingress postMessage API.
 */
function requestIngressToken(): Promise<string | null> {
  return new Promise((resolve) => {
    if (!isIngress()) {
      resolve(null);
      return;
    }

    const timeout = setTimeout(() => {
      window.removeEventListener('message', handler);
      resolve(null);
    }, 3000);

    // Determine the expected origin for postMessage validation
    let expectedOrigin = '';
    try {
      expectedOrigin = window.parent.location.origin;
    } catch {
      /* cross-origin */
    }

    function handler(event: MessageEvent) {
      // Validate origin to prevent token injection from other frames
      if (expectedOrigin && event.origin !== expectedOrigin) return;
      if (event.data?.type === 'auth/token') {
        clearTimeout(timeout);
        window.removeEventListener('message', handler);
        resolve(event.data.access_token || null);
      }
    }

    window.addEventListener('message', handler);

    try {
      window.parent.postMessage({ type: 'auth/request' }, '*');
    } catch {
      clearTimeout(timeout);
      window.removeEventListener('message', handler);
      resolve(null);
    }
  });
}

export function useHomeAssistant() {
  const clientRef = useRef<HomeAssistantClient | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      const config = getConfig();
      // Server-proxy deployments keep the Home Assistant credential on the
      // backend. Do not load a stale browser token and bypass that proxy.
      if (usesServerProxy()) {
        console.info('Abbai Flow: Server proxy mode — using REST API through Abbai Flow.');
        if (!cancelled) setConnected(true);
        return;
      }

      const [storedUrl, storedToken] = await Promise.all([
        getSecureItem(StorageKeys.HA_URL),
        getSecureItem(StorageKeys.HA_TOKEN),
      ]);
      let token = config.ha_token || storedToken || '';
      const url = storedUrl || resolveHaUrl();
      if (storedUrl || storedToken) {
        patchConfig({ ha_url: url, ha_token: token });
      }

      // If no token from config, try requesting one from HA ingress
      if (!token && isIngress()) {
        token = (await requestIngressToken()) || '';
      }

      if (!token) {
        console.warn('Abbai Flow: no HA token available. Running with preview data.');
        return;
      }

      setHaToken(token);

      if (cancelled) return;

      const client = new HomeAssistantClient(url, token);
      client.setConnectionChangeHandler(setConnected);
      clientRef.current = client;

      client.connect().catch((err) => {
        console.error('Abbai Flow: Failed to connect to Home Assistant', err);
      });
    }

    connect();

    return () => {
      cancelled = true;
      clientRef.current?.disconnect();
      clientRef.current = null;
    };
  }, []);

  const getClient = useCallback(() => clientRef.current, []);

  return { client: getClient, connected };
}
