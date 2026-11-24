import { useEffect, type Dispatch, type SetStateAction } from 'react';
import {
  formatChoreOpsOffset,
  isChoreOpenToAnyone,
  CHOREOPS_ALL_USERS,
  type ChoreOpsFrequency,
  type ChoreOpsIntervalUnit,
  type ChoreOpsWeekday,
} from '../../api/choreops';
import { normaliseName } from '../../api/planner-meta';
import type { UseChoreOpsResult } from '../../hooks/useChoreOps';
import type { I18nValue } from '../../i18n';
import type { PlannerTask } from '../../api/chore-planner-model';
import { DAY_KEYS, emptyForm, formFromLiveTask, toastWith, type FormValue } from './form';
import type { PlannerCopy } from './copy';
import { errorDiagnosticText, sameDays, sameMinute, sameNames } from './planner-utils';
import type { PlannerOverlayEvent } from './overlay-state';

interface UseChoreFormActionsOptions {
  form: FormValue;
  setForm: Dispatch<SetStateAction<FormValue>>;
  editingId: string | null;
  saving: boolean;
  setSaving: Dispatch<SetStateAction<boolean>>;
  now: Date;
  choreOps: UseChoreOpsResult;
  getTask: (id: string | null) => PlannerTask | null;
  userNameByMemberId: Map<string, string>;
  hasParentPin: boolean;
  requestPin: (title: string, description: string, run: (approverName?: string) => void) => void;
  dispatchOverlay: Dispatch<PlannerOverlayEvent>;
  showToast: (message: string, kind?: 'success' | 'error', details?: string) => void;
  showError: (error: unknown) => void;
  copy: PlannerCopy;
  t: I18nValue['t'];
  createRequest?: { kind: 'chore'; token: number };
}

/** Chore creation, editing, persistence and deletion actions. */
export function useChoreFormActions({
  form,
  setForm,
  editingId,
  saving,
  setSaving,
  now,
  choreOps,
  getTask,
  userNameByMemberId,
  hasParentPin,
  requestPin,
  dispatchOverlay,
  showToast,
  showError,
  copy: c,
  t,
  createRequest,
}: UseChoreFormActionsOptions) {
  const openNewForm = (memberId?: string) => {
    const nextForm = emptyForm(now);
    if (memberId) nextForm.memberIds = [memberId];
    setForm(nextForm);
    dispatchOverlay({ type: 'open-form' });
  };

  const createToken = createRequest?.token ?? 0;
  useEffect(() => {
    if (createToken === 0) return;
    openNewForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only the token counts
  }, [createToken]);

  const openEditForm = (task: PlannerTask) => {
    if (hasParentPin) dispatchOverlay({ type: 'close' });
    requestPin(c.edit, task.name, () => {
      // ChoreOps is the source of truth: prefill from its own record of the chore.
      const chore =
        choreOps.data?.chores.find(
          (item) => item.name.trim().toLowerCase() === task.name.trim().toLowerCase(),
        ) ?? null;
      const nextForm = formFromLiveTask(task, chore);
      if (chore) {
        const assignedNames = new Set(
          (chore.assignedUserNames ?? []).map((name) => normaliseName(name)),
        );
        const anyone = isChoreOpenToAnyone(chore);
        if (anyone) {
          nextForm.free = true;
          nextForm.memberIds = [];
        } else if (chore.assignedUserNames?.length) {
          nextForm.free = false;
          nextForm.memberIds = Array.from(userNameByMemberId.entries())
            .filter(([, userName]) => assignedNames.has(normaliseName(userName)))
            .map(([memberId]) => memberId);
        }
      }
      setForm(nextForm);
      dispatchOverlay({ type: 'open-form', editingId: task.id });
    });
  };

  /** Replace a chore definition while keeping the original recoverable on failure. */
  const replaceChore = async (
    originalName: string,
    choreId: string,
    replacement: Parameters<UseChoreOpsResult['createChore']>[0],
  ) => {
    const temporaryName = `__abbai_flow_recreate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    await choreOps.updateChore({ name: temporaryName, targetName: originalName, choreId });

    try {
      await choreOps.createChore(replacement);
    } catch (createError) {
      try {
        await choreOps.updateChore({
          name: originalName,
          targetName: temporaryName,
          choreId,
        });
      } catch (restoreError) {
        const createMessage = createError instanceof Error ? createError.message : c.noFail;
        const restoreMessage = restoreError instanceof Error ? restoreError.message : c.noFail;
        const failure = new Error(
          `${createMessage}. Could not restore the original chore: ${restoreMessage}`,
        ) as Error & { details?: string };
        failure.details = [
          'Replacement create request failed:',
          errorDiagnosticText(createError),
          'Original chore restore request failed:',
          errorDiagnosticText(restoreError),
        ].join('\n\n');
        throw failure;
      }
      throw createError;
    }

    try {
      await choreOps.deleteChore(temporaryName);
    } catch (deleteError) {
      const rollbackErrors: string[] = [];
      const rollbackDetails: string[] = [];
      try {
        await choreOps.deleteChore(replacement.name.trim());
      } catch (rollbackError) {
        rollbackErrors.push(
          `could not remove the replacement: ${rollbackError instanceof Error ? rollbackError.message : c.noFail}`,
        );
        rollbackDetails.push(errorDiagnosticText(rollbackError));
      }
      try {
        await choreOps.updateChore({
          name: originalName,
          targetName: temporaryName,
          choreId,
        });
      } catch (restoreError) {
        rollbackErrors.push(
          `could not restore the original name: ${restoreError instanceof Error ? restoreError.message : c.noFail}`,
        );
        rollbackDetails.push(errorDiagnosticText(restoreError));
      }
      const deleteMessage = deleteError instanceof Error ? deleteError.message : c.noFail;
      if (rollbackErrors.length) {
        const failure = new Error(
          `${deleteMessage}. Rollback issue: ${rollbackErrors.join('; ')}`,
        ) as Error & { details?: string };
        failure.details = [
          'Delete request failed:',
          errorDiagnosticText(deleteError),
          ...rollbackDetails.flatMap((details, index) => [
            `Rollback request ${index + 1} failed:`,
            details,
          ]),
        ].join('\n\n');
        throw failure;
      }
      throw deleteError;
    }
  };

  const saveForm = async () => {
    if (!form.name.trim() || (!form.memberIds.length && !form.free) || saving) return;

    /*
     * "Free for anyone to claim" is ChoreOps' `*` sentinel, not an empty
     * assignee list: ChoreOps treats an empty list as a dormant chore and
     * publishes no entities for it, so the chore would silently vanish.
     */
    const userNames = form.free
      ? [CHOREOPS_ALL_USERS]
      : form.memberIds
          .map((id) => userNameByMemberId.get(id))
          .filter((name): name is string => Boolean(name));
    if (userNames.length === 0) {
      showToast(c.assignToClaim);
      return;
    }

    /* A new chore is a one-off; edits keep its existing ChoreOps recurrence. */
    const frequency = form.liveFrequency;
    const originalTask = editingId ? getTask(editingId) : null;
    const originalName = originalTask?.name ?? form.name;
    const originalChore = editingId
      ? (choreOps.data?.chores.find(
          (item) => item.name.trim().toLowerCase() === originalName.trim().toLowerCase(),
        ) ?? null)
      : null;
    const labels = Array.from(
      new Set(
        form.liveLabels
          .split(',')
          .map((label) => label.trim())
          .filter(Boolean),
      ),
    );
    const labelsChanged = !originalChore || !sameNames(originalChore.labels, labels);
    let recreateForClaimModeChange = false;
    if (editingId && originalChore) {
      const assignedNames = (originalChore.assignedUserNames ?? []).map((name) =>
        normaliseName(name),
      );
      const originalCriteria = normaliseName(originalChore.completionCriteria ?? '');
      const claimModeKnown = Boolean(originalCriteria || assignedNames.length > 0);
      const effectiveCriteria = originalCriteria || 'independent';
      recreateForClaimModeChange =
        claimModeKnown &&
        ((form.free && effectiveCriteria !== 'shared_first') ||
          (!form.free && effectiveCriteria === 'shared_first' && form.memberIds.length > 1));
    }
    const schedule = {
      frequency,
      customInterval:
        frequency === 'custom' ||
        frequency === 'custom_from_complete' ||
        frequency === 'custom_from_complete_date_only'
          ? form.liveInterval
          : undefined,
      customIntervalUnit: form.liveIntervalUnit,
      applicableDays:
        frequency === 'weekly' ? form.liveWeekdays.map((day) => DAY_KEYS[day]) : undefined,
      // Sent exactly as the form shows it: ChoreOps decides whether the date is
      // acceptable and its message is what the (red) toast shows.
      dueDate: form.deadlineAt ? new Date(form.deadlineAt).toISOString() : undefined,
      description: form.liveDescription,
      autoApprove: form.liveAutoApprove,
      labels,
    };
    const frequencyChanged = Boolean(
      originalChore && frequency !== (originalChore.frequency ?? 'none'),
    );
    const intervalChanged = Boolean(
      originalChore &&
      (form.liveInterval !== (originalChore.customInterval ?? 1) ||
        form.liveIntervalUnit !== (originalChore.customIntervalUnit ?? 'days')),
    );
    const requestedDays = schedule.applicableDays ?? [];
    const daysChanged = Boolean(
      originalChore &&
      (frequency === 'weekly' || originalChore.frequency === 'weekly') &&
      !sameDays(originalChore.applicableDays, requestedDays),
    );
    const dueDateChanged = Boolean(
      originalChore && !sameMinute(schedule.dueDate, originalChore.dueDate),
    );
    const currentWindow = formatChoreOpsOffset(originalChore?.windowOffset);
    const windowChanged = Boolean(originalChore && form.liveWindow.trim() !== currentWindow);
    const updateSchedule = {
      // ChoreOps treats these as real schedule edits. Leave unchanged schedule
      // fields out of an assignee-only update, especially `due_date`: sensors
      // can publish an overdue date and the editor may otherwise replay it.
      ...(frequencyChanged ? { frequency: schedule.frequency } : {}),
      ...(frequencyChanged || intervalChanged
        ? {
            customInterval: schedule.customInterval,
            customIntervalUnit: schedule.customIntervalUnit,
          }
        : {}),
      ...(frequencyChanged || daysChanged
        ? { applicableDays: frequency === 'weekly' ? requestedDays : [] }
        : {}),
      ...(dueDateChanged && schedule.dueDate ? { dueDate: schedule.dueDate } : {}),
      ...(originalChore && form.liveDescription !== (originalChore.description ?? '')
        ? { description: form.liveDescription }
        : {}),
      ...(originalChore && form.liveAutoApprove !== Boolean(originalChore.autoApprove)
        ? { autoApprove: form.liveAutoApprove }
        : {}),
      ...(windowChanged ? { windowOffset: form.liveWindow } : {}),
      ...(labelsChanged ? { labels } : {}),
    };
    try {
      setSaving(true);
      if (editingId) {
        const renamed = normaliseName(originalName) !== normaliseName(form.name);
        let choreId: string | undefined;
        if (renamed || recreateForClaimModeChange) {
          const resolvedId =
            originalChore?.statusEntityId && choreOps.resolveChoreId
              ? await choreOps.resolveChoreId(originalChore.statusEntityId)
              : null;
          if (!resolvedId) throw new Error(t('planner.renameUnavailable'));
          choreId = resolvedId;
        }
        if (!recreateForClaimModeChange) {
          await choreOps.updateChore({
            ...updateSchedule,
            name: form.name,
            targetName: originalName,
            choreId,
            ...(!originalChore || !sameNames(originalChore.assignedUserNames, userNames)
              ? { assignedUserNames: userNames }
              : {}),
            ...(!originalChore || form.points !== originalChore.points
              ? { points: form.points }
              : {}),
            ...(form.liveReminder.trim() ? { reminderOffset: form.liveReminder } : {}),
          });
        } else {
          await replaceChore(originalName, choreId!, {
            ...schedule,
            name: form.name,
            assignedUserNames: userNames,
            completionCriteria: form.free ? 'shared_first' : 'independent',
            points: form.points,
            labels,
            icon: originalChore?.icon ?? undefined,
            customInterval: form.liveInterval,
            customIntervalUnit: form.liveIntervalUnit,
            dueDate: (() => {
              if (dueDateChanged) return schedule.dueDate;
              const existingDueDate = originalChore?.dueDate;
              if (existingDueDate && new Date(existingDueDate).getTime() > Date.now()) {
                return existingDueDate;
              }
              return undefined;
            })(),
            windowOffset: form.liveWindow,
            reminderOffset: form.liveReminder || undefined,
            autoApprove: form.liveAutoApprove,
            approvalReset: originalChore?.approvalReset,
            pendingClaims: originalChore?.pendingClaims,
            overdueHandling: originalChore?.overdueHandling,
            claimLockUntilWindow: originalChore?.claimLockUntilWindow,
            notificationChannel: originalChore?.notificationChannel,
            notificationImportance: originalChore?.notificationImportance,
          });
        }
      } else {
        await choreOps.createChore({
          ...schedule,
          name: form.name,
          assignedUserNames: userNames,
          // One open chore that whoever gets to it first completes — otherwise
          // every child would get their own private copy to check off.
          completionCriteria: form.free ? 'shared_first' : undefined,
          points: form.points,
          windowOffset: form.liveWindow,
          reminderOffset: form.liveReminder,
        });
      }
      dispatchOverlay({ type: 'close' });
      showToast(toastWith(editingId ? c.savedToast : c.created, form.name.trim()));
    } catch (err) {
      // ChoreOps replies with the exact reason (e.g. "The requested changes
      // require a future due date"); show it verbatim in the red toast.
      showError(err);
    } finally {
      setSaving(false);
    }
  };

  const removeTask = async (task: PlannerTask) => {
    try {
      await choreOps.deleteChore(task.name);
      dispatchOverlay({ type: 'close' });
      showToast(toastWith(c.removedToast, task.name));
    } catch (err) {
      showError(err);
    }
  };

  /** Reopen a completed task; standalone chores become shared-first for everyone. */
  const reuseTask = async (task: PlannerTask) => {
    if (saving) return;
    const choreMatches =
      choreOps.data?.chores.filter(
        (item) => normaliseName(item.name) === normaliseName(task.name),
      ) ?? [];
    const taskUserName = task.memberId ? userNameByMemberId.get(task.memberId) : undefined;
    const chore =
      (task.inRoutine && taskUserName
        ? choreMatches.find(
            (item) => normaliseName(item.assignee ?? '') === normaliseName(taskUserName),
          )
        : undefined) ?? choreMatches[0];
    if (!chore) {
      showError(new Error(t('planner.renameUnavailable')));
      return;
    }

    const futureDueDate =
      chore.dueDate && new Date(chore.dueDate).getTime() > Date.now() ? chore.dueDate : null;
    try {
      setSaving(true);
      if (task.inRoutine) {
        const userName =
          normaliseName(chore.completionCriteria ?? '') === 'independent' && taskUserName
            ? taskUserName
            : undefined;
        await choreOps.setChoreDueDate(task.name, futureDueDate, userName);
      } else if (normaliseName(chore.completionCriteria ?? '') === 'shared_first') {
        const previousAssignees = chore.assignedUserNames ?? [];
        const needsAllUsers = !previousAssignees.some(
          (name) => normaliseName(name) === normaliseName(CHOREOPS_ALL_USERS),
        );
        if (needsAllUsers) {
          await choreOps.updateChore({
            name: chore.name,
            targetName: chore.name,
            assignedUserNames: [CHOREOPS_ALL_USERS],
          });
        }
        try {
          await choreOps.setChoreDueDate(task.name, futureDueDate);
        } catch (resetError) {
          if (needsAllUsers && previousAssignees.length > 0) {
            try {
              await choreOps.updateChore({
                name: chore.name,
                targetName: chore.name,
                assignedUserNames: previousAssignees,
              });
            } catch (restoreError) {
              const failure = new Error(
                `${resetError instanceof Error ? resetError.message : c.noFail}. Could not restore the original assignees: ${restoreError instanceof Error ? restoreError.message : c.noFail}`,
              ) as Error & { details?: string };
              failure.details = [
                'Reset request failed:',
                errorDiagnosticText(resetError),
                'Assignee restore request failed:',
                errorDiagnosticText(restoreError),
              ].join('\n\n');
              throw failure;
            }
          }
          throw resetError;
        }
      } else {
        const choreId =
          chore.statusEntityId && choreOps.resolveChoreId
            ? await choreOps.resolveChoreId(chore.statusEntityId)
            : null;
        if (!choreId) throw new Error(t('planner.renameUnavailable'));
        await replaceChore(task.name, choreId, {
          name: chore.name,
          assignedUserNames: [CHOREOPS_ALL_USERS],
          completionCriteria: 'shared_first',
          icon: chore.icon,
          points: chore.points,
          description: chore.description,
          labels: chore.labels,
          frequency: (chore.frequency ?? 'none') as ChoreOpsFrequency,
          customInterval: chore.customInterval,
          customIntervalUnit: chore.customIntervalUnit as ChoreOpsIntervalUnit | null,
          applicableDays: (chore.applicableDays ?? []) as ChoreOpsWeekday[],
          dueDate: futureDueDate ?? undefined,
          windowOffset: chore.windowOffset,
          autoApprove: chore.autoApprove,
          approvalReset: chore.approvalReset,
          pendingClaims: chore.pendingClaims,
          overdueHandling: chore.overdueHandling,
          claimLockUntilWindow: chore.claimLockUntilWindow,
          notificationChannel: chore.notificationChannel,
          notificationImportance: chore.notificationImportance,
        });
      }
      dispatchOverlay({ type: 'close' });
      showToast(toastWith(c.useAgain, task.name));
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  };

  return { openNewForm, openEditForm, saveForm, removeTask, reuseTask };
}
