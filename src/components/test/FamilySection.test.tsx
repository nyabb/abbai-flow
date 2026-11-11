import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { FamilySection } from '../settings/sections/FamilySection';
import { I18nContext, createI18n } from '../../i18n';
import type { AbbaiSettings } from '../../hooks/useSettings';
import type { FamilyMember, Routine } from '../../types/family';

/**
 * Family section.
 *
 * This is the most stateful of the settings screens, so the cases pin the
 * behaviour the extraction had to preserve: the list, add/edit/delete (with the
 * two-step delete confirmation), the routine editor including task ordering,
 * and the photo-upload error path.
 *
 * `useChoreOps` (HA people lookup) and `useRoutines` (localStorage store) are
 * mocked — the section is what's under test, not the transports.
 */
const mocks = vi.hoisted(() => ({
  routines: [] as Routine[],
  addRoutine: vi.fn(),
  updateRoutine: vi.fn(),
  removeRoutine: vi.fn(),
  imageFileToDataUrl: vi.fn(),
}));

vi.mock('../../hooks/useRoutines', () => ({
  useRoutines: () => ({
    routines: mocks.routines,
    addRoutine: mocks.addRoutine,
    updateRoutine: mocks.updateRoutine,
    removeRoutine: mocks.removeRoutine,
    isTaskCompletedToday: () => false,
    toggleTask: vi.fn(),
  }),
}));

vi.mock('../../hooks/useChoreOps', () => ({
  useChoreOps: () => ({
    data: {
      users: [{ name: 'Noor' }, { name: 'Sam' }],
      people: [
        { name: 'Noor', picture: '/api/image/serve/noor/512x512' },
        { name: 'Papa', picture: null },
      ],
    },
    loading: false,
    error: null,
    available: true,
  }),
}));

vi.mock('../../utils/member-photo', () => ({
  imageFileToDataUrl: mocks.imageFileToDataUrl,
  resolveMemberPhoto: (photo: string) => photo,
}));

const settings = { themeId: 'skylight' } as AbbaiSettings;

const MEMBERS: FamilyMember[] = [
  { id: 'm1', name: 'Noor', avatar: '🧑', color: '#3b82f6', role: 'child' },
  { id: 'm2', name: 'Papa', avatar: '👨', color: '#10b981', role: 'parent' },
];

function renderSection(members: FamilyMember[] = MEMBERS) {
  const t = createI18n('nl');
  const onAddMember = vi.fn();
  const onUpdateMember = vi.fn();
  const onRemoveMember = vi.fn();
  const utils = render(
    <I18nContext.Provider value={t}>
      <FamilySection
        settings={settings}
        onUpdateSettings={vi.fn()}
        t={t.t}
        members={members}
        onAddMember={onAddMember}
        onUpdateMember={onUpdateMember}
        onRemoveMember={onRemoveMember}
        calendars={[]}
      />
    </I18nContext.Provider>,
  );
  return { ...utils, t, onAddMember, onUpdateMember, onRemoveMember };
}

beforeEach(() => {
  mocks.routines = [];
  mocks.addRoutine.mockReset().mockResolvedValue(undefined);
  mocks.updateRoutine.mockReset().mockResolvedValue(undefined);
  mocks.removeRoutine.mockReset().mockResolvedValue(undefined);
  mocks.imageFileToDataUrl.mockReset();
});

describe('FamilySection', () => {
  it('lists every member with their role', () => {
    const { t } = renderSection();

    expect(screen.getByText('Noor')).toBeInTheDocument();
    expect(screen.getByText('Papa')).toBeInTheDocument();
    expect(screen.getByText(t.t('settings.family.child'))).toBeInTheDocument();
    expect(screen.getByText(t.t('settings.family.parent'))).toBeInTheDocument();
  });

  it('shows an empty state when there are no members', () => {
    const { t } = renderSection([]);

    expect(screen.getByText(t.t('settings.family.empty'))).toBeInTheDocument();
  });

  it('adds a member through the form', () => {
    const { t, onAddMember } = renderSection();

    fireEvent.click(screen.getByText(t.t('settings.family.addMember')));
    fireEvent.change(screen.getByPlaceholderText(t.t('settings.family.namePlaceholder')), {
      target: { value: 'Sam' },
    });
    fireEvent.click(screen.getByText(t.t('settings.family.addMemberBtn')));

    expect(onAddMember).toHaveBeenCalledTimes(1);
    expect(onAddMember).toHaveBeenCalledWith(expect.objectContaining({ name: 'Sam' }));
    // The form closes and the list is shown again.
    expect(screen.getByText(t.t('settings.family.addMember'))).toBeInTheDocument();
  });

  it('edits an existing member in place', () => {
    const { t, onUpdateMember } = renderSection();

    fireEvent.click(screen.getByLabelText(t.t('settings.family.editMember', { name: 'Noor' })));
    const name = screen.getByDisplayValue('Noor');
    fireEvent.change(name, { target: { value: 'Noor Jansen' } });
    fireEvent.click(screen.getByText(t.t('settings.family.saveChanges')));

    expect(onUpdateMember).toHaveBeenCalledTimes(1);
    expect(onUpdateMember).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ name: 'Noor Jansen' }),
    );
  });

  it('requires a second click before deleting a member', () => {
    const { t, onRemoveMember } = renderSection();
    const del = screen.getByLabelText(t.t('settings.family.deleteMember', { name: 'Noor' }));

    fireEvent.click(del);
    expect(onRemoveMember).not.toHaveBeenCalled();
    expect(screen.getByText(t.t('common.sure'))).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(t.t('settings.family.deleteMember', { name: 'Noor' })));
    expect(onRemoveMember).toHaveBeenCalledWith('m1');
  });

  it('cancels the member form without saving', () => {
    const { t, onAddMember } = renderSection();

    fireEvent.click(screen.getByText(t.t('settings.family.addMember')));
    fireEvent.change(screen.getByPlaceholderText(t.t('settings.family.namePlaceholder')), {
      target: { value: 'Sam' },
    });
    fireEvent.click(screen.getByText(t.t('common.cancel')));

    expect(onAddMember).not.toHaveBeenCalled();
    expect(screen.getByText(t.t('settings.family.addMember'))).toBeInTheDocument();
  });

  it('reports a failed photo conversion instead of crashing', async () => {
    const { t, container } = renderSection();
    mocks.imageFileToDataUrl.mockRejectedValue(new Error('decode failed'));

    fireEvent.click(screen.getByText(t.t('settings.family.addMember')));
    const fileInput = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'photo.png', { type: 'image/png' });
    fireEvent.change(fileInput, { target: { files: [file] } });

    expect(await screen.findByText(t.t('settings.family.photoError'))).toBeInTheDocument();
  });

  it('saves a new routine with the tasks in their arranged order', async () => {
    const { t } = renderSection();

    fireEvent.click(screen.getByLabelText(t.t('settings.family.routinesFor', { name: 'Noor' })));
    fireEvent.click(screen.getByText(t.t('settings.family.addRoutine')));

    fireEvent.change(screen.getByPlaceholderText(t.t('settings.family.routineNamePlaceholder')), {
      target: { value: 'Ochtend' },
    });
    // The form starts with one task row; add a second one.
    fireEvent.change(
      screen.getByPlaceholderText(t.t('settings.family.taskPlaceholder', { n: 1 })),
      {
        target: { value: 'Tanden poetsen' },
      },
    );
    fireEvent.click(screen.getByText(t.t('settings.family.addTask')));
    fireEvent.change(
      screen.getByPlaceholderText(t.t('settings.family.taskPlaceholder', { n: 2 })),
      {
        target: { value: 'Aankleden' },
      },
    );
    // Move the second task above the first.
    fireEvent.click(screen.getAllByLabelText(t.t('settings.family.moveUp'))[1]);
    fireEvent.click(screen.getByText(t.t('settings.family.saveRoutine')));

    await waitFor(() => expect(mocks.addRoutine).toHaveBeenCalledTimes(1));
    expect(mocks.addRoutine).toHaveBeenCalledWith({
      name: 'Ochtend',
      member_id: 'm1',
      time_of_day: 'morning',
      tasks: [
        expect.objectContaining({ name: 'Aankleden', order: 0 }),
        expect.objectContaining({ name: 'Tanden poetsen', order: 1 }),
      ],
    });
  });

  it('lists the routines of the selected member and deletes one after confirming', () => {
    mocks.routines = [
      {
        id: 'r1',
        name: 'Avond',
        member_id: 'm1',
        time_of_day: 'evening',
        tasks: [{ id: 't1', name: 'Lezen', order: 0 }],
      },
    ] as Routine[];
    const { t } = renderSection();

    fireEvent.click(screen.getByLabelText(t.t('settings.family.routinesFor', { name: 'Noor' })));
    expect(screen.getByText('Avond')).toBeInTheDocument();

    const remove = screen.getByLabelText(t.t('settings.family.deleteRoutine', { name: 'Avond' }));
    fireEvent.click(remove);
    expect(mocks.removeRoutine).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText(t.t('settings.family.deleteRoutine', { name: 'Avond' })));
    expect(mocks.removeRoutine).toHaveBeenCalledWith('r1');
  });
});
