import { useCallback, useEffect, useRef, useState } from 'react';
import type { BluetoothControl, BluetoothSnapshot } from '../api/bluetooth-types';

const EMPTY_SNAPSHOT: BluetoothSnapshot = {
  configured: false,
  connection: 'disabled',
  adapter: null,
  scanning: false,
  devices: [],
  challenge: null,
  notice: null,
  error: null,
  updatedAt: 0,
};

export function useBluetoothDevices() {
  const [snapshot, setSnapshot] = useState(EMPTY_SNAPSHOT);
  const snapshotRef = useRef(snapshot);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    const applySnapshot = (next: BluetoothSnapshot) => {
      if (disposed || next.updatedAt < snapshotRef.current.updatedAt) return;
      snapshotRef.current = next;
      setSnapshot(next);
      setLoading(false);
    };

    fetch('/abbai-flow/bluetooth/state', { headers: { Accept: 'application/json' } })
      .then(async (response) => {
        if (!response.ok) throw new Error('Bluetooth service unavailable');
        applySnapshot((await response.json()) as BluetoothSnapshot);
      })
      .catch(() => {
        if (disposed) return;
        const disconnected: BluetoothSnapshot = {
          ...snapshotRef.current,
          connection: 'disconnected',
          error: 'Bluetooth service unavailable',
        };
        snapshotRef.current = disconnected;
        setSnapshot(disconnected);
        setLoading(false);
      });

    const events = new EventSource('/abbai-flow/bluetooth/events');
    events.addEventListener('state', (event) => {
      try {
        applySnapshot(JSON.parse((event as MessageEvent<string>).data) as BluetoothSnapshot);
      } catch {
        // Keep the latest valid state if a stream frame is malformed.
      }
    });

    return () => {
      disposed = true;
      events.close();
    };
  }, []);

  const control = useCallback(async (value: BluetoothControl) => {
    try {
      const response = await fetch('/abbai-flow/bluetooth/control', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(value),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) return { ok: false, error: result.error || 'Bluetooth request failed' };
      return { ok: true };
    } catch {
      return { ok: false, error: 'Bluetooth service unavailable' };
    }
  }, []);

  return { snapshot, loading, control };
}
