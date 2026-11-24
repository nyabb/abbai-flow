/**
 * Family settings: the member list, the add/edit form (avatar, photo, colour,
 * PIN, linked HA person and calendars) and the per-member routine editor.
 *
 * This file owns the state and the writes; the three views live in `./family/`
 * and are pure — they render props and call back.
 */
import { useState, useCallback } from 'react';
import type { ChangeEvent } from 'react';
import { useChoreOps } from '../../../hooks/useChoreOps';
import { useRoutines } from '../../../hooks/useRoutines';
import { normalizePin, type FamilyMember, type Routine } from '../../../types/family';
import { imageFileToDataUrl } from '../../../utils/member-photo';
import { MemberFormView } from './family/MemberFormView';
import { MemberList } from './family/MemberList';
import { RoutineEditor } from './family/RoutineEditor';
import { RoutineEditorDialog } from '../../routines/RoutineEditorDialog';
import type { RoutineEditorRequest } from '../../routines/RoutineEditorDialog';
import {
  EMPTY_FORM,
  type MemberForm,
  type MemberFormMode,
  type PersonOption,
} from './family/types';
import type { SettingsSectionContext } from './context';

export interface FamilyCalendarSummary {
  id: string;
  name: string;
  color?: string;
}

export interface FamilySectionProps extends SettingsSectionContext {
  members: FamilyMember[];
  onAddMember: (member: Omit<FamilyMember, 'id'>) => void;
  onUpdateMember: (id: string, data: Partial<Omit<FamilyMember, 'id'>>) => void;
  onRemoveMember: (id: string) => void;
  calendars: FamilyCalendarSummary[];
}

export function FamilySection({
  settings,
  t,
  members,
  onAddMember,
  onUpdateMember,
  onRemoveMember,
  calendars,
}: FamilySectionProps) {
  const [editingMember, setEditingMember] = useState<string | null>(null);

  const { data: choreOpsData } = useChoreOps();
  const choreOpsUsers = choreOpsData?.users ?? [];
  const choreOpsNames = new Set(choreOpsUsers.map((u) => u.name.trim().toLowerCase()));

  /** `entity_picture` published on an HA person entity, if they have one. */
  const personPicture = (personName: string): string | null =>
    (choreOpsData?.people ?? []).find(
      (person) => person.name.trim().toLowerCase() === personName.trim().toLowerCase(),
    )?.picture ?? null;

  /** HA people (incl. non-ChoreOps members such as parents) + ChoreOps users. */
  const peopleOptions: PersonOption[] = [
    ...choreOpsUsers.map((u) => ({
      name: u.name,
      hasChoreOps: true,
      picture: personPicture(u.name),
    })),
    ...(choreOpsData?.people ?? [])
      .filter((p) => !choreOpsNames.has(p.name.trim().toLowerCase()))
      .map((p) => ({ name: p.name, hasChoreOps: false, picture: p.picture })),
  ];

  /** True when a person is already attached to a different member. */
  const isLinkedElsewhere = (personName: string): boolean => {
    const target = personName.trim().toLowerCase();
    return members.some(
      (m) =>
        m.id !== editingMember &&
        ((m.choreops_user ?? '').trim().toLowerCase() === target ||
          m.name.trim().toLowerCase() === target),
    );
  };

  const [memberForm, setMemberForm] = useState<MemberForm>(EMPTY_FORM);
  const [memberFormMode, setMemberFormMode] = useState<MemberFormMode>('list');
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // ---- Routine editor state ----
  const routinesApi = useRoutines();
  const [routinesFor, setRoutinesFor] = useState<FamilyMember | null>(null);
  const [routineEditorRequest, setRoutineEditorRequest] = useState<RoutineEditorRequest | null>(
    null,
  );

  const handleStartCreateRoutine = useCallback(() => {
    setRoutineEditorRequest({ token: Date.now(), memberId: routinesFor?.id });
  }, [routinesFor]);

  const handleStartEditRoutine = useCallback((routine: Routine) => {
    setRoutineEditorRequest({ token: Date.now(), routine, memberId: routine.member_id });
  }, []);

  const handleDeleteRoutine = useCallback(
    async (id: string) => {
      await routinesApi.removeRoutine(id);
    },
    [routinesApi],
  );

  const handleBackFromRoutines = useCallback(() => {
    setRoutinesFor(null);
    setRoutineEditorRequest(null);
  }, []);

  // ---- Family member handlers ----
  const handleStartAdd = useCallback(() => {
    setMemberForm(EMPTY_FORM);
    setPhotoError(null);
    setEditingMember(null);
    setMemberFormMode('add');
  }, []);

  const handleStartEdit = useCallback((member: FamilyMember) => {
    setMemberForm({
      name: member.name,
      avatar: member.avatar,
      photo: member.photo ?? '',
      color: member.color,
      role: member.role,
      pin: member.pin ?? '',
      calendar_entity: member.calendar_entity ?? '',
      additional_calendar_entities: member.additional_calendar_entities ?? [],
      choreops_user: member.choreops_user ?? '',
    });
    setPhotoError(null);
    setEditingMember(member.id);
    setMemberFormMode('edit');
  }, []);

  /** Downscale an uploaded file to a small data URL so it survives offline. */
  const handlePhotoUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      // Reset so picking the same file twice still fires onChange.
      event.target.value = '';
      if (!file) return;

      setPhotoError(null);
      try {
        const dataUrl = await imageFileToDataUrl(file);
        setMemberForm((form) => ({ ...form, photo: dataUrl }));
      } catch {
        setPhotoError(t('settings.family.photoError'));
      }
    },
    [t],
  );

  const handleSaveMember = useCallback(() => {
    if (!memberForm.name.trim()) return;
    const normalizedPin = normalizePin(memberForm.pin);
    const data = {
      name: memberForm.name.trim(),
      avatar: memberForm.avatar,
      photo: memberForm.photo || undefined,
      color: memberForm.color,
      role: memberForm.role,
      pin: normalizedPin || undefined,
      calendar_entity: memberForm.calendar_entity || undefined,
      additional_calendar_entities:
        memberForm.additional_calendar_entities.length > 0
          ? memberForm.additional_calendar_entities
          : undefined,
      choreops_user: memberForm.choreops_user || undefined,
    };
    if (memberFormMode === 'edit' && editingMember) {
      onUpdateMember(editingMember, data);
    } else {
      onAddMember(data);
    }
    setMemberFormMode('list');
    setMemberForm(EMPTY_FORM);
    setEditingMember(null);
  }, [memberForm, memberFormMode, editingMember, onAddMember, onUpdateMember]);

  const handleDeleteMember = useCallback(
    (id: string) => {
      if (confirmDelete === id) {
        onRemoveMember(id);
        setConfirmDelete(null);
      } else {
        setConfirmDelete(id);
        setTimeout(() => setConfirmDelete(null), 3000);
      }
    },
    [confirmDelete, onRemoveMember],
  );

  const handleCancelMemberForm = useCallback(() => {
    setMemberFormMode('list');
    setMemberForm(EMPTY_FORM);
    setEditingMember(null);
  }, []);

  if (routinesFor) {
    return (
      <>
        <RoutineEditor
          member={routinesFor}
          routines={routinesApi.routines.filter((routine) => routine.member_id === routinesFor.id)}
          t={t}
          locale={settings.locale}
          weekStartsOn={settings.weekStartsOn}
          onBack={handleBackFromRoutines}
          onStartCreate={handleStartCreateRoutine}
          onStartEdit={handleStartEditRoutine}
          onDelete={handleDeleteRoutine}
        />
        {routineEditorRequest && (
          <RoutineEditorDialog
            key={routineEditorRequest.token}
            request={routineEditorRequest}
            members={members}
            locale={settings.locale}
            weekStartsOn={settings.weekStartsOn}
            onClose={() => setRoutineEditorRequest(null)}
            onSaved={routinesApi.refresh}
          />
        )}
      </>
    );
  }

  return (
    <>
      <h2 className="settings-section-title">{t('settings.family.title')}</h2>
      <p className="settings-section-desc">{t('settings.family.desc')}</p>

      {memberFormMode === 'list' ? (
        <MemberList
          members={members}
          confirmDelete={confirmDelete}
          t={t}
          onOpenRoutines={setRoutinesFor}
          onEdit={handleStartEdit}
          onDelete={handleDeleteMember}
          onAdd={handleStartAdd}
        />
      ) : (
        <MemberFormView
          form={memberForm}
          mode={memberFormMode === 'edit' ? 'edit' : 'add'}
          photoError={photoError}
          linkedPhoto={personPicture(memberForm.choreops_user)}
          peopleOptions={peopleOptions}
          isLinkedElsewhere={isLinkedElsewhere}
          calendars={calendars}
          t={t}
          onChange={setMemberForm}
          onPhotoUpload={handlePhotoUpload}
          onCancel={handleCancelMemberForm}
          onSave={handleSaveMember}
        />
      )}
    </>
  );
}
