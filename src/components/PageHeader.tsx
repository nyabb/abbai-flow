/**
 * The page header band — the shared "hero" at the top of every page.
 *
 * It dates the page instead of merely naming it: the weekday, an oversized day
 * numeral and the month sit as one block on the left, the live clock closes the
 * band on the right, and the page title rides between them. On a wall display
 * the first thing anyone reads is "what day is it", so that numeral carries the
 * largest type on the screen and the title is sized to sit beside it.
 *
 * Reuses `.abbai-flow-header` so it inherits the active skin's band gradient.
 */
import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { ChevronLeft, Volume2 } from 'lucide-react';
import { useTranslation } from '../i18n';
import { Clock } from './Clock';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useMusicDockContext } from './MusicDockContext';

export interface PageHeaderProps {
  title: ReactNode;
  /** Secondary text under the title, e.g. a count or a hint. */
  subtitle?: string;
  /** Right-hand slot for a view's own controls, before the clock. */
  actions?: ReactNode;
  /** When given, a back arrow is rendered in front of the title. */
  onBack?: () => void;
  /** The day this page represents; defaults to today. */
  date?: Date;
  /** Hide the live clock where the view supplies its own time display. */
  hideClock?: boolean;
  /** Optional hook for a page that keeps a legacy selector on the shared header. */
  className?: string;
  actionsClassName?: string;
  backClassName?: string;
  clockClassName?: string;
}

interface PageHeaderActionsProps {
  children?: ReactNode;
  className?: string;
  clockClassName?: string;
  /** Use a page-specific clock, or pass null to omit the clock. */
  clock?: ReactNode;
}

/** Shared header controls keep the language picker in one consistent place. */
export function PageHeaderActions({
  children,
  className = 'page-header-actions',
  clockClassName,
  clock,
}: PageHeaderActionsProps) {
  const { t } = useTranslation();
  const musicDock = useMusicDockContext();

  return (
    <div className={className}>
      {children}
      {clock === undefined ? (
        clockClassName ? (
          <span className={clockClassName}>
            <Clock />
          </span>
        ) : (
          <Clock />
        )
      ) : (
        clock
      )}
      <button
        type="button"
        className={`page-header-sound-toggle${musicDock?.playing ? ' is-playing' : ''}`}
        aria-label={t('music.nowPlaying')}
        aria-pressed={musicDock?.open ?? false}
        aria-expanded={musicDock?.open ?? false}
        aria-controls="music-dock-panel"
        title={t('music.openMusicView')}
        data-music-dock-trigger="true"
        onClick={() => musicDock?.toggle()}
      >
        <Volume2 aria-hidden="true" />
      </button>
      <LanguageSwitcher />
    </div>
  );
}

/**
 * The stacked weekday / day numeral / month block.
 *
 * Exported on its own for layouts that share the date treatment but keep their
 * own header structure, such as Lists with its tab row. Colours are inherited
 * rather than fixed to the skin band ink, so it reads correctly on any band.
 */
export function HeaderDate({ date }: { date?: Date }) {
  const { dateLocale } = useTranslation();
  const day = date ?? new Date();

  return (
    <div className="page-header-date">
      <span className="page-header-weekday">{format(day, 'EEEE', { locale: dateLocale })}</span>
      <strong className="page-header-day">{format(day, 'd', { locale: dateLocale })}</strong>
      <span className="page-header-month">{format(day, 'MMMM', { locale: dateLocale })}</span>
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
  onBack,
  date,
  hideClock,
  className,
  actionsClassName,
  backClassName,
  clockClassName,
}: PageHeaderProps) {
  const { t } = useTranslation();

  return (
    <header
      className={`abbai-flow-header page-header page-header--hero${className ? ` ${className}` : ''}`}
    >
      <HeaderDate date={date} />

      <div className="page-header-main">
        {onBack && (
          <button
            type="button"
            className={`icon-btn page-header-back${backClassName ? ` ${backClassName}` : ''}`}
            onClick={onBack}
            aria-label={t('common.back')}
          >
            <ChevronLeft size={20} strokeWidth={2} />
          </button>
        )}
        <div className="page-header-copy">
          <h1 className="page-header-title">{title}</h1>
          {subtitle && <span className="page-header-subtitle">{subtitle}</span>}
        </div>
      </div>

      <PageHeaderActions
        className={actionsClassName}
        clockClassName={clockClassName}
        clock={hideClock ? null : undefined}
      >
        {actions}
      </PageHeaderActions>
    </header>
  );
}
