import { ChevronDown } from 'lucide-react';
import { useTranslation } from '../i18n';
import { LOCALE_OPTIONS } from '../i18n/locales';

export interface LanguageSwitcherProps {
  locale?: string;
  onLocaleChange?: (locale: string) => void;
}

/** Compact language control for the top edge of every app page. */
export function LanguageSwitcher({
  locale,
  onLocaleChange,
}: LanguageSwitcherProps) {
  const i18n = useTranslation();
  const value = locale ?? i18n.locale;
  const changeLocale = onLocaleChange ?? i18n.onLocaleChange;

  return (
    <span className="language-switcher">
      <select
        className="language-switcher-select"
        value={value}
        onChange={(event) => changeLocale?.(event.target.value)}
        aria-label={i18n.t('settings.general.languageLabel')}
        title={i18n.t('settings.general.languageLabel')}
        disabled={!changeLocale}
      >
        {LOCALE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown aria-hidden="true" />
    </span>
  );
}
