import { useEffect, useState } from 'react';
import {
  fetchChoresManChoreHistory,
  fetchChoresManRewardHistory,
  type ChoresManChoreHistoryEntry,
  type ChoresManRewardHistoryEntry,
} from '../../api/choresman-history';

interface UsePlannerHistoryOptions {
  goalsOpen: boolean;
  goalsUserName: string | null;
  childViewOpen: boolean;
  childUserName: string | null;
  choresManAvailable: boolean;
}

/** Reads completion and reward history from ChoresMan's local store. */
export function usePlannerHistory({
  goalsOpen,
  goalsUserName,
  childViewOpen,
  childUserName,
  choresManAvailable,
}: UsePlannerHistoryOptions) {
  const [rewardHistory, setRewardHistory] = useState<{
    userName: string;
    entries: ChoresManRewardHistoryEntry[];
  } | null>(null);
  const [choreHistory, setChoreHistory] = useState<{
    userName: string;
    entries: ChoresManChoreHistoryEntry[];
  } | null>(null);

  useEffect(() => {
    if (!goalsOpen || !goalsUserName || !choresManAvailable) {
      setRewardHistory(null);
      return;
    }
    let current = true;
    setRewardHistory(null);
    void fetchChoresManRewardHistory(goalsUserName)
      .then((entries) => {
        if (current) setRewardHistory({ userName: goalsUserName, entries });
      })
      .catch(() => {
        if (current) setRewardHistory({ userName: goalsUserName, entries: [] });
      });
    return () => {
      current = false;
    };
  }, [goalsOpen, goalsUserName, choresManAvailable]);

  useEffect(() => {
    if (!childViewOpen || !childUserName || !choresManAvailable) {
      setChoreHistory(null);
      return;
    }
    let current = true;
    setChoreHistory(null);
    void fetchChoresManChoreHistory(childUserName)
      .then((entries) => {
        if (current) setChoreHistory({ userName: childUserName, entries });
      })
      .catch(() => {
        if (current) setChoreHistory({ userName: childUserName, entries: [] });
      });
    return () => {
      current = false;
    };
  }, [childViewOpen, childUserName, choresManAvailable]);

  return {
    goalsLedgerHistory: rewardHistory?.userName === goalsUserName ? rewardHistory.entries : [],
    childChoreHistory:
      choreHistory?.userName === childUserName ? choreHistory.entries : null,
  };
}
