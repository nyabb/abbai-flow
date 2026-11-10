/**
 * The page header band — the shared "hero" at the top of every page.
 *
 * It dates the page instead of merely naming it: the weekday, an oversized day
 * numeral and the month sit as one block on the left, the live clock closes the
 * band on the right, and the page title rides between them. On a wall display
 * the first thing anyone reads is "what day is it", so that numeral carries the
 * largest type on the screen and the title is sized to sit beside it.
 *
 * Reuses `.beacon-header` so it inherits the active skin's band gradient.
 */
import type { ReactNode } from 'react';
import { format } from 'date-fns';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from '../i18n';
import { Clock } from './Clock';

export interface PageHeaderProps {
  title: string;
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
}

export function PageHeader({
  title,
  subtitle,
  actions,
  onBack,
  date,
  hideClock,
}: PageHeaderProps) {
  const { t, dateLocale } = useTranslation();
  const day = date ?? new Date();

  return (
    <header className="beacon-header page-header page-header--hero">
      <div className="page-header-date">
        <span className="page-header-weekday">{format(day, 'EEEE', { locale: dateLocale })}</span>
        <strong className="page-header-day">{format(day, 'd', { locale: dateLocale })}</strong>
        <span className="page-header-month">{format(day, 'MMMM', { locale: dateLocale })}</span>
      </div>

      <div className="page-header-main">
        {onBack && (
          <button
            type="button"
            className="icon-btn page-header-back"
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

      <div className="page-header-actions">
        {actions}
        {!hideClock && <Clock />}
      </div>
    </header>
  );
}
