/**
 * Types shared by the family section and its three views.
 */
import { MEMBER_COLORS, type Routine } from '../../../../types/family';

/** The member form's value while it is being edited. */
export interface MemberForm {
  name: string;
  avatar: string;
  photo: string;
  color: string;
  role: 'parent' | 'child';
  pin: string;
  calendar_entity: string;
  additional_calendar_entities: string[];
  choreops_user: string;
}

/** A blank member form: what "add member" starts from. */
export const EMPTY_FORM: MemberForm = {
  name: '',
  avatar: '🧑',
  photo: '',
  color: MEMBER_COLORS[0],
  role: 'child',
  pin: '',
  calendar_entity: '',
  additional_calendar_entities: [],
  choreops_user: '',
};

/** What the member form holds while it is being edited. */
export type MemberFormMode = 'list' | 'add' | 'edit';

/** The routine form's value; `id: null` means "not saved yet". */
export interface RoutineFormValue {
  id: string | null;
  name: string;
  time_of_day: Routine['time_of_day'];
  tasks: { id: string | null; name: string }[];
}

/** A person the member can be linked to (HA person or ChoreOps user). */
export interface PersonOption {
  name: string;
  hasChoreOps: boolean;
  picture: string | null;
}
