import { useEffect, useMemo, useState } from 'react';
import {
  fetchChoreOpsChoreHistory,
  type ChoreOpsChoreHistoryEntity,
  type ChoreOpsChoreHistoryEntry,
} from '../../api/choreops-chore-history';
import {
  fetchChoreOpsRewardHistory,
  type ChoreOpsRewardHistoryEntry,
} from '../../api/choreops-ledger';
import type { ChoreOpsChore } from '../../types/choreops';

interface UsePlannerHistoryOptions {
  goalsOpen: boolean;
  goalsUserName: string | null;
  childViewOpen: boolean;
  childUserName: string | null;
  chores: ChoreOpsChore[];
  choreOpsAvailable: boolean;
}

/** Owns the optional ChoreOps ledgers shown in the goals and child history sheets. */
export function usePlannerHistory({
  goalsOpen,
  goalsUserName,
  childViewOpen,
  childUserName,
  chores,
  choreOpsAvailable,
}: UsePlannerHistoryOptions) {
  const [rewardHistory, setRewardHistory] = useState<{
    userName: string;
    entries: ChoreOpsRewardHistoryEntry[];
  } | null>(null);
  const [choreHistory, setChoreHistory] = useState<{
    userName: string;
    entityKey: string;
    entries: ChoreOpsChoreHistoryEntry[];
  } | null>(null);

  const childHistoryEntities = useMemo<ChoreOpsChoreHistoryEntity[]>(() => {
    const userKey = childUserName?.trim().toLocaleLowerCase();
    if (!userKey) return [];
    return chores.flatMap((chore) => {
      return chore.statusEntityId && chore.assignee?.trim().toLocaleLowerCase() === userKey
        ? [
            {
              entityId: chore.statusEntityId,
              choreName: chore.name,
              points: chore.points,
            },
          ]
        : [];
    });
  }, [chores, childUserName]);

  const childHistoryEntityKey = childHistoryEntities
    .map((entity) => entity.entityId)
    .sort()
    .join('|');

  useEffect(() => {
    if (!goalsOpen || !goalsUserName || !choreOpsAvailable) {
      setRewardHistory(null);
      return;
    }

    let current = true;
    setRewardHistory(null);
    void fetchChoreOpsRewardHistory(goalsUserName)
      .then((entries) => {
        if (current) setRewardHistory({ userName: goalsUserName, entries });
      })
      .catch(() => {
        // Older ChoreOps versions may not expose get_ledger. Keep the
        // Abbai Flow history available when the optional ledger query fails.
        if (current) setRewardHistory({ userName: goalsUserName, entries: [] });
      });

    return () => {
      current = false;
    };
  }, [goalsOpen, goalsUserName, choreOpsAvailable]);

  useEffect(() => {
    if (!childViewOpen || !childUserName || !choreOpsAvailable) {
      setChoreHistory(null);
      return;
    }

    let current = true;
    setChoreHistory(null);
    void fetchChoreOpsChoreHistory(childHistoryEntities)
      .then((entries) => {
        if (current) {
          setChoreHistory({
            userName: childUserName,
            entityKey: childHistoryEntityKey,
            entries,
          });
        }
      })
      .catch(() => {
        if (current) {
          setChoreHistory({
            userName: childUserName,
            entityKey: childHistoryEntityKey,
            entries: [],
          });
        }
      });

    return () => {
      current = false;
    };
  }, [
    childViewOpen,
    childUserName,
    childHistoryEntities,
    childHistoryEntityKey,
    choreOpsAvailable,
  ]);

  return {
    goalsLedgerHistory: rewardHistory?.userName === goalsUserName ? rewardHistory.entries : [],
    childChoreHistory:
      choreHistory?.userName === childUserName && choreHistory.entityKey === childHistoryEntityKey
        ? choreHistory.entries
        : null,
  };
}
