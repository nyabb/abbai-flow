import { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useTranslation } from '../../i18n';

interface SecretInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoComplete?: string;
  disabled?: boolean;
}

export function SecretInput({
  label,
  value,
  onChange,
  placeholder = '',
  autoComplete = 'new-password',
  disabled = false,
}: SecretInputProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const toggleLabel = t(
    visible ? 'settings.integrations.hideSecret' : 'settings.integrations.showSecret',
  );

  return (
    <div className="settings-secret-input settings-input--wide">
      <input
        aria-label={label}
        autoComplete={autoComplete}
        className="settings-input settings-secret-input-field"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={visible ? 'text' : 'password'}
        value={value}
      />
      <button
        aria-label={toggleLabel}
        aria-pressed={visible}
        className="settings-secret-input-toggle"
        disabled={disabled}
        onClick={() => setVisible((current) => !current)}
        title={toggleLabel}
        type="button"
      >
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
  );
}
