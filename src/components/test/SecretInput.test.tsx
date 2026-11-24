import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nContext, createI18n } from '../../i18n';
import { SecretInput } from '../settings/SecretInput';

describe('SecretInput', () => {
  it('starts masked, can reveal and hide the value, and reports edits', () => {
    const onChange = vi.fn();
    render(
      <I18nContext.Provider value={createI18n('en-US')}>
        <SecretInput label="API token" value="" onChange={onChange} />
      </I18nContext.Provider>,
    );

    const input = screen.getByLabelText('API token') as HTMLInputElement;
    expect(input.type).toBe('password');

    fireEvent.change(input, { target: { value: 'token-value' } });
    expect(onChange).toHaveBeenCalledWith('token-value');

    fireEvent.click(screen.getByRole('button', { name: 'Show secret' }));
    expect(input.type).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: 'Hide secret' }));
    expect(input.type).toBe('password');
  });
});
