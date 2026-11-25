import type { ReactNode } from 'react';

interface CollapsibleRegionProps {
  open: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
  role?: 'region';
  ariaLabel?: string;
}

/** A kept-mounted disclosure region with an accessible, animated collapse. */
export function CollapsibleRegion({
  open,
  children,
  className = '',
  id,
  role,
  ariaLabel,
}: CollapsibleRegionProps) {
  return (
    <div
      className={`collapsible-region${open ? ' is-open' : ''} ${className}`.trim()}
      id={id}
      role={role}
      aria-label={ariaLabel}
      aria-hidden={!open}
      inert={!open}
    >
      <div className="collapsible-region__inner">{children}</div>
    </div>
  );
}
