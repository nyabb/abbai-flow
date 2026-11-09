/**
 * Shared settings controls.
 *
 * Toggle, Segment and Slider are used by nearly every settings section. They
 * live here so a section file only contains that section's fields, and so the
 * three controls can be tested once instead of through eight screens.
 */

export function Toggle({
  checked,
  onChange,
  disabled = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="settings-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="settings-toggle-track" />
      <span className="settings-toggle-thumb" />
    </label>
  );
}

export function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="settings-segment">
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          className={`settings-segment-btn ${value === opt.value ? 'settings-segment-btn--active' : ''}`}
          onClick={() => onChange(opt.value)}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  unit?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="settings-slider-wrapper">
      <input
        type="range"
        className="settings-slider"
        value={value}
        min={min}
        max={max}
        step={step ?? 1}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="settings-slider-value">
        {value}
        {unit ?? ''}
      </span>
    </div>
  );
}
