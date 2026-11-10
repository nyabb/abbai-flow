/**
 * The page header band.
 *
 * Dashboard and Calendar each have their own band (`dash-topbar`,
 * `beacon-header`); this is the shared minimal version for the views that used
 * to open straight into content, so Timer and Photos get the same "screen band"
 * the rest of the app has.
 */
import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from '../i18n';

export interface PageHeaderProps {
  title: string;
  /** Secondary text next to the title, e.g. today's date. */
  subtitle?: string;
  /** Right-hand slot for a view's own controls (a clock, a toggle…). */
  actions?: ReactNode;
  /** When given, a back arrow is rendered in front of the title. */
  onBack?: () => void;
}

export function PageHeader({ title, subtitle, actions, onBack }: PageHeaderProps) {
  const { t } = useTranslation();

  return (
    <header className="beacon-header page-header">
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
        <h1 className="page-header-title">{title}</h1>
        {subtitle && <span className="page-header-subtitle">{subtitle}</span>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
