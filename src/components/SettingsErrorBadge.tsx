export function SettingsErrorBadge({
  label = 'Needs attention',
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={`settings-error-badge${className ? ` ${className}` : ''}`}
      role="img"
      aria-label={label}
      title={label}
    />
  );
}
