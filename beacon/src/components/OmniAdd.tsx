import { useState, useRef, useEffect, useCallback } from 'react';
import { CalendarPlus, ShoppingCart, CheckSquare, Timer, Repeat } from 'lucide-react';
import { hapticTap } from '../hooks/useHaptics';
import { useTranslation } from '../i18n';

interface OmniAddProps {
  onAddEvent: () => void;
  onAddGroceryItem: () => void;
  onAddChore: () => void;
  /** Creates a repeating chore; the chores page opens its form in routine mode. */
  onAddRoutine?: () => void;
  onNavigateTimer: () => void;
  sidebarPosition?: 'left' | 'right' | 'bottom';
  /** Controlled mode: the trigger can live elsewhere (e.g. the bottom tab bar). */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}

interface ActionDef {
  id: string;
  label: string;
  icon: React.ReactNode;
  handler: () => void;
}

export function OmniAdd({
  onAddEvent,
  onAddGroceryItem,
  onAddChore,
  onAddRoutine,
  onNavigateTimer,
  sidebarPosition = 'left',
  open,
  onOpenChange,
  showTrigger = true,
}: OmniAddProps) {
  const { t } = useTranslation();
  const [internalExpanded, setInternalExpanded] = useState(false);
  const expanded = open ?? internalExpanded;
  const containerRef = useRef<HTMLDivElement>(null);

  const setExpanded = useCallback(
    (next: boolean) => {
      setInternalExpanded(next);
      onOpenChange?.(next);
    },
    [onOpenChange],
  );

  const actions: ActionDef[] = [
    { id: 'timer', label: t('nav.timer'), icon: <Timer size={22} />, handler: onNavigateTimer },
    {
      id: 'chore',
      label: t('omniAdd.chore'),
      icon: <CheckSquare size={22} />,
      handler: onAddChore,
    },
    ...(onAddRoutine
      ? [
          {
            id: 'routine',
            label: t('omniAdd.routine'),
            icon: <Repeat size={22} />,
            handler: onAddRoutine,
          },
        ]
      : []),
    {
      id: 'grocery',
      label: t('omniAdd.grocery'),
      icon: <ShoppingCart size={22} />,
      handler: onAddGroceryItem,
    },
    {
      id: 'event',
      label: t('omniAdd.event'),
      icon: <CalendarPlus size={22} />,
      handler: onAddEvent,
    },
  ];

  const toggle = useCallback(() => {
    hapticTap();
    setExpanded(!expanded);
  }, [expanded, setExpanded]);

  const handleAction = useCallback(
    (action: ActionDef) => {
      setExpanded(false);
      action.handler();
    },
    [setExpanded],
  );

  // Close on outside click
  useEffect(() => {
    if (!expanded) return;

    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setExpanded(false);
      }
    };

    // Use a short delay so the opening click doesn't immediately close
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClick);
    }, 10);

    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClick);
    };
  }, [expanded]);

  // Close on Escape
  useEffect(() => {
    if (!expanded) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setExpanded(false);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [expanded]);

  return (
    <div
      ref={containerRef}
      className={`omni-add omni-add--sidebar-${sidebarPosition} ${
        expanded ? 'omni-add--expanded' : ''
      } ${showTrigger ? '' : 'omni-add--sheet'}`}
    >
      {/* Backdrop blur overlay */}
      {expanded && <div className="omni-add-backdrop" onClick={() => setExpanded(false)} />}

      {/* Action buttons (fan upward). While collapsed they are invisible *and*
          inert: a transparent button that still takes taps steals them from
          whatever sits underneath (the More sheet's X, a form's Save button). */}
      <div className="omni-add-actions" aria-hidden={!expanded} inert={!expanded}>
        {actions.map((action, i) => (
          <button
            key={action.id}
            type="button"
            className="omni-add-action"
            style={{ '--omni-delay': `${i * 50}ms` } as React.CSSProperties}
            onClick={() => handleAction(action)}
            tabIndex={expanded ? 0 : -1}
            aria-label={action.label}
          >
            <span className="omni-add-action-icon">{action.icon}</span>
            <span className="omni-add-action-label">{action.label}</span>
          </button>
        ))}
      </div>

      {/* Main FAB */}
      {showTrigger && (
        <button
          type="button"
          className="omni-add-fab"
          onClick={toggle}
          aria-label={expanded ? t('omniAdd.closeQuickAdd') : t('omniAdd.quickAdd')}
          aria-expanded={expanded}
        >
          <span className={`omni-add-fab-icon ${expanded ? 'omni-add-fab-icon--open' : ''}`}>
            +
          </span>
        </button>
      )}
    </div>
  );
}
