import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, screen, waitFor } from '@testing-library/react';
import { ChorePlanner } from '../ChorePlanner';
import { I18nContext, createI18n } from '../../i18n';
import type { FamilyMember } from '../../types/family';
import type { ChoreOpsState } from '../../types/choreops';

/**
 * ChoreOps rejects some edits with its own wording ("The requested changes
 * require a future due date"). Those messages used to be swallowed; they must
 * now land in the notification in red, while successful requests stay green.
 */
const mocks = vi.hoisted(() => ({
  createChore: vi.fn(),
  state: { current: null as ChoreOpsState | null },
}));

vi.mock('../../hooks/useChoreOps', () => ({
  useChoreOps: () => ({
    data: mocks.state.current,
    loading: false,
    error: null,
    available: true,
    refresh: () => {},
    pressButton: async () => {},
    claimChore: async () => {},
    createChore: mocks.createChore,
    updateChore: async () => {},
    createReward: async () => {},
    deleteChore: async () => {},
    approveReward: async () => {},
  }),
}));

const ZARA: FamilyMember = {
  id: 'c1',
  name: 'Zara',
  avatar: '\u{1F642}',
  color: '#1f7a5a',
  role: 'child',
};

function state(): ChoreOpsState {
  return {
    users: [
      {
        name: 'Zara',
        slug: 'zara',
        points: 25,
        dueToday: 0,
        claimed: 0,
        approved: 0,
        completedToday: 0,
      },
    ],
    chores: [],
    rewards: [],
    people: [],
    pointsByUser: { zara: 25 },
    pendingApprovals: { chores: 0, rewards: 0 },
    entryId: 'entry-1',
    available: true,
  };
}

const NL = createI18n('nl');

function renderPlanner() {
  return render(
    <I18nContext.Provider value={NL}>
      <ChorePlanner
        members={[ZARA]}
        nextAppointment={null}
        locale="nl"
        onLocaleChange={() => {}}
      />
    </I18nContext.Provider>,
  );
}

/** Fill the "new chore" sheet just enough to submit it. */
function submitNewChore(container: HTMLElement) {
  fireEvent.click(container.querySelector<HTMLButtonElement>('.planner-add')!);
  fireEvent.change(screen.getByLabelText('Naam'), { target: { value: 'Afwassen' } });
  const picker = container.querySelector<HTMLElement>('.planner-member-picker')!;
  const zara = Array.from(picker.querySelectorAll('button')).find((button) =>
    button.textContent?.includes('Zara'),
  )!;
  fireEvent.click(zara);
  fireEvent.click(screen.getByRole('button', { name: 'Taakje aanmaken' }));
}

describe('ChorePlanner notifications', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.state.current = state();
    mocks.createChore.mockReset();
  });

  it('shows the ChoreOps rejection verbatim in a red toast', async () => {
    mocks.createChore.mockRejectedValue(
      new Error('The requested changes require a future due date'),
    );
    const { container } = renderPlanner();

    submitNewChore(container);

    await waitFor(() => {
      const toast = container.querySelector('.planner-toast--error');
      expect(toast?.textContent).toBe('The requested changes require a future due date');
    });
    expect(container.querySelector('.planner-toast--success')).toBeNull();
  });

  it('uses the green toast when the request succeeds', async () => {
    mocks.createChore.mockResolvedValue(undefined);
    const { container } = renderPlanner();

    submitNewChore(container);

    await waitFor(() => {
      expect(container.querySelector('.planner-toast--success')?.textContent).toContain('Afwassen');
    });
    expect(container.querySelector('.planner-toast--error')).toBeNull();
  });
});
