import type { CSSProperties } from 'react';

interface LoadingPlaceholderProps {
  /** Accessible description announced while the placeholder is visible. */
  label: string;
  lines?: number;
  className?: string;
  widths?: number[];
}

/** A theme-aware shimmer used anywhere text is waiting for remote data. */
export function LoadingPlaceholder({
  label,
  lines = 2,
  className = '',
  widths = [94, 74, 58],
}: LoadingPlaceholderProps) {
  return (
    <div className={`loading-placeholder ${className}`.trim()} role="status" aria-label={label}>
      <span className="loading-placeholder__lines" aria-hidden="true">
        {Array.from({ length: lines }, (_, index) => (
          <span
            key={index}
            className="loading-placeholder__bar"
            style={{ '--loading-width': `${widths[index % widths.length]}%` } as CSSProperties}
          />
        ))}
      </span>
    </div>
  );
}

/** Inline activity indicator for saves, submissions, and busy rows. */
export function ActivitySpinner({ className = '' }: { className?: string }) {
  return <span className={`activity-spinner ${className}`.trim()} aria-hidden="true" />;
}
