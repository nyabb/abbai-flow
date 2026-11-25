import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

interface ActiveDrag {
  pointerId: number;
  startY: number;
  lastY: number;
  lastAt: number;
  velocity: number;
}

/** Adds a dedicated downward drag handle to mobile sheets and dialogs. */
export function useSheetDrag(onDismiss: () => void, enabled = true) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const activeDrag = useRef<ActiveDrag | null>(null);
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  useEffect(
    () => () => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);
    },
    [],
  );

  const resetDrag = useCallback(() => {
    activeDrag.current = null;
    setDragging(false);
    setOffset(0);
  }, []);

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!enabled || event.button !== 0) return;
      event.preventDefault();
      activeDrag.current = {
        pointerId: event.pointerId,
        startY: event.clientY,
        lastY: event.clientY,
        lastAt: performance.now(),
        velocity: 0,
      };
      event.currentTarget.setPointerCapture?.(event.pointerId);
      setOffset(0);
      setDragging(true);
    },
    [enabled],
  );

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const current = activeDrag.current;
    if (!current || event.pointerId !== current.pointerId) return;
    event.preventDefault();
    const now = performance.now();
    current.velocity = Math.max(0, event.clientY - current.lastY) / Math.max(1, now - current.lastAt);
    setOffset(Math.max(0, event.clientY - current.startY));
    current.lastY = event.clientY;
    current.lastAt = now;
  }, []);

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const current = activeDrag.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const distance = Math.max(0, event.clientY - current.startY);
      activeDrag.current = null;
      setDragging(false);

      if (distance >= 96 || (distance >= 28 && current.velocity >= 0.65)) {
        setOffset(window.innerHeight || 800);
        dismissTimer.current = setTimeout(() => onDismissRef.current(), 170);
      } else {
        setOffset(0);
      }
    },
    [],
  );

  const onPointerCancel = useCallback(() => resetDrag(), [resetDrag]);

  return {
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
      onLostPointerCapture: onPointerCancel,
    },
    surfaceProps: {
      'data-sheet-dragging': dragging ? 'true' : undefined,
      style: offset ? { transform: `translateY(${offset}px)` } : undefined,
    },
  };
}
