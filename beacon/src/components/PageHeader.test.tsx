import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PageHeader } from './PageHeader';
import { I18nContext, createI18n } from '../i18n';

const NL = createI18n('nl');

function renderHeader(props: Parameters<typeof PageHeader>[0]) {
  return render(
    <I18nContext.Provider value={NL}>
      <PageHeader {...props} />
    </I18nContext.Provider>,
  );
}

describe('PageHeader', () => {
  it('renders the title as the page heading', () => {
    renderHeader({ title: 'Timer' });

    expect(screen.getByRole('heading', { level: 1, name: 'Timer' })).toBeInTheDocument();
  });

  it('shows the subtitle when given one', () => {
    renderHeader({ title: 'Timer', subtitle: 'maandag 10 november' });

    expect(screen.getByText('maandag 10 november')).toBeInTheDocument();
  });

  it('only offers a back button when a handler is passed', () => {
    const { rerender } = renderHeader({ title: 'Timer' });
    expect(screen.queryByRole('button')).toBeNull();

    const onBack = vi.fn();
    rerender(
      <I18nContext.Provider value={NL}>
        <PageHeader title="Timer" onBack={onBack} />
      </I18nContext.Provider>,
    );

    fireEvent.click(screen.getByRole('button', { name: NL.t('common.back') }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('renders right-hand actions', () => {
    renderHeader({ title: 'Timer', actions: <span>actie</span> });

    expect(screen.getByText('actie')).toBeInTheDocument();
  });
});
