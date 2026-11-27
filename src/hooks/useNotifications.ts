import { useEffect, useRef, useCallback } from 'react';
import { CalendarEvent } from '../types';
import abbaiIcon from '../assets/abbai-flow-icon.svg';

const CHECK_INTERVAL = 60 * 1000; // 1 minute
const DEFAULT_NOTIFY_BEFORE_MINUTES = 15;

/**
 * Checks upcoming events every minute and fires browser notifications
 * notifyBeforeMinutes before each event (Settings > Calendar >
 * notificationTimingLabel — previously this was hardcoded to 15 minutes
 * regardless of that setting).
 */
export function useNotifications(
  events: CalendarEvent[],
  enabled = true,
  notifyBeforeMinutes: number = DEFAULT_NOTIFY_BEFORE_MINUTES,
) {
  const notifyBeforeMs = notifyBeforeMinutes * 60 * 1000;
  // Track which event IDs we've already notified about to avoid duplicates
  const notifiedRef = useRef<Set<string>>(new Set());

  // Request notification permission on mount
  useEffect(() => {
    if (!enabled) return;
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, [enabled]);

  const checkUpcoming = useCallback(() => {
    const now = Date.now();

    for (const event of events) {
      if (event.allDay) continue;

      const eventStart = new Date(event.start).getTime();
      const diff = eventStart - now;

      // Event is within 15 minutes but hasn't started yet, and we haven't notified
      if (diff > 0 && diff <= notifyBeforeMs && !notifiedRef.current.has(event.id)) {
        notifiedRef.current.add(event.id);

        const minutesUntil = Math.round(diff / 60_000);
        const body = minutesUntil <= 1
          ? `Starting now`
          : `Starts in ${minutesUntil} minutes`;

        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification(event.title, {
            body,
            icon: abbaiIcon,
            tag: `abbai-flow-event-${event.id}`,
          });
        }

      }
    }

    // Prune old notification IDs for events that have already passed
    const activeIds = new Set(events.map((e) => e.id));
    for (const id of notifiedRef.current) {
      if (!activeIds.has(id)) {
        notifiedRef.current.delete(id);
      }
    }
  }, [events, notifyBeforeMs]);

  useEffect(() => {
    if (!enabled) return;
    // Check immediately on mount / event change
    checkUpcoming();

    const interval = setInterval(checkUpcoming, CHECK_INTERVAL);
    return () => clearInterval(interval);
  }, [checkUpcoming, enabled]);
}
