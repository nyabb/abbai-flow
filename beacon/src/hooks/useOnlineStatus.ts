/**
 * Whether the browser believes it has a network connection.
 *
 * `navigator.onLine` is only a hint (it is true on a captive portal), but it is
 * the one signal that separates "this device has no network" from "the server
 * did not answer" — and those two need different messages on a wall display.
 */
import { useEffect, useState } from 'react';

export function useOnlineStatus(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  return online;
}
