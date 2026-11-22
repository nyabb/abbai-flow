import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageSwitcher } from '../LanguageSwitcher';
import { createI18n, I18nContext } from '../../i18n';
import { LOCALE_OPTIONS } from '../../i18n/locales';

describe('LanguageSwitcher', () => {
  it('offers every supported locale and saves the selected locale', () => {
    const onLocaleChange = vi.fn();
    render(
      <I18nContext.Provider value={createI18n('nl', onLocaleChange)}>
        <LanguageSwitcher />
      </I18nContext.Provider>,
    );

    const select = screen.getByRole('combobox', { name: 'Taal / Regio' }) as HTMLSelectElement;
    expect(select.value).toBe('nl');
    expect(Array.from(select.options).map((option) => option.value)).toEqual(
      LOCALE_OPTIONS.map((option) => option.value),
    );

    fireEvent.change(select, { target: { value: 'ja' } });
    expect(onLocaleChange).toHaveBeenCalledWith('ja');
  });

  it('allows a page to provide its own locale source', () => {
    const onLocaleChange = vi.fn();
    render(
      <I18nContext.Provider value={createI18n('en-US')}>
        <LanguageSwitcher locale="de" onLocaleChange={onLocaleChange} />
      </I18nContext.Provider>,
    );

    const select = screen.getByRole('combobox', { name: 'Language / Locale' }) as HTMLSelectElement;
    expect(select.value).toBe('de');
    fireEvent.change(select, { target: { value: 'fr' } });
    expect(onLocaleChange).toHaveBeenCalledWith('fr');
  });
});
