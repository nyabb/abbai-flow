import { useEffect, useId, useRef, useState } from 'react';
import { MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { useTranslation } from '../../i18n';
import { CollapsibleRegion } from '../CollapsibleRegion';

interface RoutineActionsMenuProps {
  routineName: string;
  onEdit: () => void;
  onDelete: () => void;
}

/** Shared edit/delete dropdown for every place a family routine is displayed. */
export function RoutineActionsMenu({ routineName, onEdit, onDelete }: RoutineActionsMenuProps) {
  const { t } = useTranslation();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (!confirmingDelete) return;
    const timer = setTimeout(() => setConfirmingDelete(false), 3000);
    return () => clearTimeout(timer);
  }, [confirmingDelete]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setConfirmingDelete(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        setConfirmingDelete(false);
      }
    };
    document.addEventListener('mousedown', closeOutside);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOutside);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    setConfirmingDelete(false);
  };

  return (
    <div className="routine-actions" ref={rootRef}>
      <button
        type="button"
        className="routine-actions-trigger"
        aria-label={`${t('planner.action')}: ${routineName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <MoreVertical size={18} aria-hidden="true" />
      </button>
      <CollapsibleRegion
        open={open}
        className="routine-actions-menu-region"
        id={menuId}
      >
        <div className="routine-actions-menu" role="menu" aria-label={routineName}>
          <button
            type="button"
            role="menuitem"
            aria-label={t('settings.family.editRoutine', { name: routineName })}
            onClick={() => {
              close();
              onEdit();
            }}
          >
            <Pencil size={15} aria-hidden="true" />
            {t('planner.edit')}
          </button>
          <button
            type="button"
            role="menuitem"
            className="routine-actions-delete"
            aria-label={t('settings.family.deleteRoutine', { name: routineName })}
            onClick={() => {
              if (confirmingDelete) {
                close();
                onDelete();
              } else {
                setConfirmingDelete(true);
              }
            }}
          >
            <Trash2 size={15} aria-hidden="true" />
            {confirmingDelete ? t('planner.sure') : t('planner.remove')}
          </button>
        </div>
      </CollapsibleRegion>
    </div>
  );
}
