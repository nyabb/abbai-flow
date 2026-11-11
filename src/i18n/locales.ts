import { enUS, enGB, es, fr, de, it, pt, nl, ja, ko, type Locale } from 'date-fns/locale';

export type LangCode = 'en' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'nl' | 'ja' | 'ko';

/** Maps a `AbbaiSettings.locale` value (as offered in Settings > General)
 *  to the translation language it should use. en-US/en-GB share one
 *  English translation set — only their date-fns locale differs. */
const LANG_BY_LOCALE: Record<string, LangCode> = {
  'en-US': 'en',
  'en-GB': 'en',
  es: 'es',
  fr: 'fr',
  de: 'de',
  it: 'it',
  pt: 'pt',
  nl: 'nl',
  ja: 'ja',
  ko: 'ko',
};

const DATE_FNS_LOCALE_BY_LOCALE: Record<string, Locale> = {
  'en-US': enUS,
  'en-GB': enGB,
  es,
  fr,
  de,
  it,
  pt,
  nl,
  ja,
  ko,
};

export function langForLocale(locale: string): LangCode {
  return LANG_BY_LOCALE[locale] ?? 'en';
}

/**
 * Every locale Abbai Flow can display, in the order they should be offered.
 *
 * This is the single list used by Settings > General **and** by the chores
 * header picker, so both always offer exactly the same languages.
 * Labels are endonyms (each language in its own script) on purpose: someone
 * looking for their language should recognise it without understanding the
 * current UI language.
 */
export const LOCALE_OPTIONS: { value: string; label: string }[] = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'es', label: 'Español' },
  { value: 'fr', label: 'Français' },
  { value: 'de', label: 'Deutsch' },
  { value: 'it', label: 'Italiano' },
  { value: 'pt', label: 'Português' },
  { value: 'nl', label: 'Nederlands' },
  { value: 'ja', label: '日本語' },
  { value: 'ko', label: '한국어' },
];

export function dateFnsLocaleFor(locale: string): Locale {
  return DATE_FNS_LOCALE_BY_LOCALE[locale] ?? enUS;
}
