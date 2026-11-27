import { useEffect, useRef, useState } from 'react';
import {
  Calendar,
  ListChecks,
  Music,
  MoreHorizontal,
  ShoppingCart,
  Timer as TimerIcon,
  CloudSun,
  Utensils,
} from 'lucide-react';
import { useTranslation, type TranslationKey } from '../i18n';
import { useMediaQuery } from '../hooks/useMediaQuery';

export type SidebarView =
  | 'calendar'
  | 'chores'
  | 'grocery'
  | 'meals'
  | 'music'
  | 'timer'
  | 'weather'
  | 'settings';

interface SidebarProps {
  activeView: SidebarView;
  onChangeView: (view: SidebarView) => void;
}

const ICON_SIZE = 24;
const STROKE_WIDTH = 1.5;

interface NavItem {
  id: Exclude<SidebarView, 'settings'>;
  icon: React.ReactNode;
  labelKey: TranslationKey;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: 'calendar',
    icon: <Calendar size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.calendar',
  },
  {
    id: 'chores',
    icon: <ListChecks size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.chores',
  },
  {
    id: 'grocery',
    icon: <ShoppingCart size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.grocery',
  },
  {
    id: 'meals',
    icon: <Utensils size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.meals',
  },
  {
    id: 'music',
    icon: <Music size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.music',
  },
  {
    id: 'timer',
    icon: <TimerIcon size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.timer',
  },
  {
    id: 'weather',
    icon: <CloudSun size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />,
    labelKey: 'nav.weather',
  },
];

/** The kiosk and desktop dock retain the same destination order. */
const FULL_NAV_IDS: NavItem['id'][] = [
  'calendar',
  'meals',
  'grocery',
  'chores',
  'music',
  'weather',
  'timer',
];
/** Narrow phones keep the four household destinations visible, with Chores centered. */
const COMPACT_NAV_IDS: NavItem['id'][] = ['calendar', 'meals', 'chores', 'grocery'];
const COMPACT_MORE_IDS: NavItem['id'][] = ['music', 'weather', 'timer'];

export function Sidebar({ activeView, onChangeView }: SidebarProps) {
  const { t } = useTranslation();
  const compactPhone = useMediaQuery('(max-width: 480px)');
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRootRef = useRef<HTMLDivElement>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const itemFor = (id: NavItem['id']) => NAV_ITEMS.find((item) => item.id === id)!;
  const navIds = compactPhone ? COMPACT_NAV_IDS : FULL_NAV_IDS;
  const navItems = navIds.map(itemFor);
  const moreItems = COMPACT_MORE_IDS.map(itemFor);
  const activeViewInMore = COMPACT_MORE_IDS.includes(activeView as NavItem['id']);

  useEffect(() => {
    if (!moreOpen) return;

    const closeIfOutside = (event: PointerEvent) => {
      if (!moreRootRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMoreOpen(false);
      moreButtonRef.current?.focus();
    };

    document.addEventListener('pointerdown', closeIfOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeIfOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [moreOpen]);

  useEffect(() => {
    if (!compactPhone) setMoreOpen(false);
  }, [compactPhone]);

  return (
    <nav className="mobile-tab-bar" aria-label={t('nav.mainNavigation')}>
      {navItems.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`mobile-tab ${activeView === item.id ? 'mobile-tab--active' : ''}`}
          onClick={() => onChangeView(item.id)}
          aria-label={t(item.labelKey)}
          aria-current={activeView === item.id ? 'page' : undefined}
        >
          {item.icon}
          <span className="mobile-tab-label">{t(item.labelKey)}</span>
        </button>
      ))}
      {compactPhone && (
        <div className="mobile-tab-more" ref={moreRootRef}>
          <button
            ref={moreButtonRef}
            type="button"
            className={`mobile-tab mobile-tab--more${activeViewInMore ? ' mobile-tab--active' : ''}`}
            onClick={() => setMoreOpen((open) => !open)}
            aria-label={t('nav.more')}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-current={activeViewInMore ? 'page' : undefined}
          >
            <MoreHorizontal size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />
            <span className="mobile-tab-label">{t('nav.more')}</span>
          </button>
          {moreOpen && (
            <div className="mobile-more-menu" role="menu" aria-label={t('nav.more')}>
              {moreItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="menuitem"
                  className={`mobile-more-menu-item${activeView === item.id ? ' is-active' : ''}`}
                  onClick={() => {
                    onChangeView(item.id);
                    setMoreOpen(false);
                  }}
                  aria-current={activeView === item.id ? 'page' : undefined}
                >
                  {item.icon}
                  <span>{t(item.labelKey)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </nav>
  );
}
