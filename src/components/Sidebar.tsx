import {
  Calendar,
  ListChecks,
  ShoppingCart,
  Music,
  Settings,
  Timer as TimerIcon,
  CloudSun,
  Utensils,
  Plus,
} from 'lucide-react';
import abbaiIcon from '../assets/abbai-flow-icon.svg';
import { useTranslation, type TranslationKey } from '../i18n';

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
  position?: 'left' | 'right' | 'bottom';
  /** Opens quick-add from the desktop sidebar. Mobile uses the OmniAdd FAB. */
  onQuickAdd?: () => void;
}

const ICON_SIZE = 24;
const STROKE_WIDTH = 1.5;

interface NavItem {
  id: SidebarView;
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

/** Pages shown in order in the phone tab bar. Quick add is a separate FAB. */
const NAV_LEFT_IDS: SidebarView[] = ['calendar', 'chores'];
const NAV_RIGHT_IDS: SidebarView[] = ['grocery', 'timer', 'music'];
const MOBILE_NAV_IDS: SidebarView[] = [
  'calendar',
  'meals',
  'grocery',
  'chores',
  'music',
  'weather',
  'timer',
];
/** Desktop keeps these below the divider, next to Settings. */
const NAV_EXTRA_IDS: SidebarView[] = ['meals', 'weather'];

export function Sidebar({ activeView, onChangeView, position = 'left', onQuickAdd }: SidebarProps) {
  const { t } = useTranslation();

  const itemFor = (id: SidebarView) => NAV_ITEMS.find((item) => item.id === id)!;
  const navLeft = NAV_LEFT_IDS.map(itemFor);
  const navRight = NAV_RIGHT_IDS.map(itemFor);
  const mobileNav = MOBILE_NAV_IDS.map(itemFor);
  const navExtra = NAV_EXTRA_IDS.map(itemFor);
  const quickAddLabel = t('omniAdd.quickAdd');

  return (
    <>
      {/* Desktop sidebar */}
      <nav
        className={`sidebar sidebar--desktop sidebar--${position}`}
        aria-label={t('nav.mainNavigation')}
        style={position === 'bottom' ? { display: 'none' } : undefined}
      >
        {/* Abbai Flow logo */}
        <div className="sidebar-logo">
          <img src={abbaiIcon} alt="Abbai Flow" width={32} height={32} />
        </div>

        {/* Main nav icons with quick add between the left and right groups. */}
        <div className="sidebar-nav-group">
          {navLeft.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-icon ${activeView === item.id ? 'sidebar-icon--active' : ''}`}
              onClick={() => onChangeView(item.id)}
              title={t(item.labelKey)}
              aria-label={t(item.labelKey)}
            >
              {item.icon}
            </button>
          ))}
          {onQuickAdd && (
            <button
              type="button"
              className="sidebar-icon sidebar-icon--add"
              onClick={onQuickAdd}
              title={quickAddLabel}
              aria-label={quickAddLabel}
            >
              <Plus size={ICON_SIZE} strokeWidth={2} />
            </button>
          )}
          {navRight.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-icon ${activeView === item.id ? 'sidebar-icon--active' : ''}`}
              onClick={() => onChangeView(item.id)}
              title={t(item.labelKey)}
              aria-label={t(item.labelKey)}
            >
              {item.icon}
            </button>
          ))}
        </div>

        {/* Divider */}
        <div className="sidebar-divider" />

        {/* Bottom utility icons */}
        <div className="sidebar-nav-group sidebar-nav-group--bottom">
          {navExtra.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`sidebar-icon ${activeView === item.id ? 'sidebar-icon--active' : ''}`}
              onClick={() => onChangeView(item.id)}
              title={t(item.labelKey)}
              aria-label={t(item.labelKey)}
            >
              {item.icon}
            </button>
          ))}
          <button
            type="button"
            className={`sidebar-icon ${activeView === 'settings' ? 'sidebar-icon--active' : ''}`}
            onClick={() => onChangeView('settings')}
            title={t('nav.settings')}
            aria-label={t('nav.settings')}
          >
            <Settings size={ICON_SIZE} strokeWidth={STROKE_WIDTH} />
          </button>
        </div>
      </nav>

      {/* Mobile bottom tab bar (hidden on desktop via CSS) */}
      <nav className="mobile-tab-bar" aria-label={t('nav.mainNavigation')}>
        <svg
          className="mobile-tab-bar-wave"
          viewBox="0 0 1000 100"
          preserveAspectRatio="none"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M0 24 H385 C440 24 440 0 500 0 C560 0 560 24 615 24 H1000 V100 H0 Z" />
          <path
            className="mobile-tab-bar-wave-border"
            d="M0 24 H385 C440 24 440 0 500 0 C560 0 560 24 615 24 H1000"
          />
        </svg>
        {mobileNav.map((item) => (
          <button
            key={item.id}
            type="button"
            className={`mobile-tab ${item.id === 'chores' ? 'mobile-tab--featured' : ''} ${activeView === item.id ? 'mobile-tab--active' : ''}`}
            onClick={() => onChangeView(item.id)}
            aria-label={t(item.labelKey)}
            aria-current={activeView === item.id ? 'page' : undefined}
          >
            {item.icon}
            <span className="mobile-tab-label">{t(item.labelKey)}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
