import { ChevronDown } from 'lucide-react';
import { useTranslation } from '../i18n';
import { LOCALE_OPTIONS } from '../i18n/locales';

export interface LanguageSwitcherProps {
  locale?: string;
  onLocaleChange?: (locale: string) => void;
  variant?: 'default' | 'planner';
}

/** Compact language control for the top edge of every app page. */
export function LanguageSwitcher({
  locale,
  onLocaleChange,
  variant = 'default',
}: LanguageSwitcherProps) {
  const i18n = useTranslation();
  const value = locale ?? i18n.locale;
  const changeLocale = onLocaleChange ?? i18n.onLocaleChange;
  const planner = variant === 'planner';

  return (
    <span className={planner ? 'planner-language' : 'language-switcher'}>
      <select
        className={planner ? 'planner-language-select' : 'language-switcher-select'}
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
