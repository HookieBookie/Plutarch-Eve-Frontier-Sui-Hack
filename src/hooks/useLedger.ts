import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { GoalType } from "../context/GoalContext";

export type LedgerEventType =
  | "goal_start"
  | "goal_complete"
  | "goal_cancel"
  | "mission_start"
  | "mission_complete"
  | "cycle_complete"
  | "budget_fund"
  | "budget_allocate";

export interface LedgerEntry {
  id: number;
  timestamp: number;
  eventType: LedgerEventType;
  goalId?: number;
  goalType?: GoalType;
  goalDescription?: string;
  missionIdx?: number;
  missionPhase?: string;
  missionItem?: string;
  amount?: number;
}

function buildUrl(ssuId: string, tribeId: string) {
  return `/api/ledger?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`;
}

async function fetchLedger(ssuId: string, tribeId: string): Promise<LedgerEntry[]> {
  const res = await fetch(buildUrl(ssuId, tribeId));
  const data = await res.json();
  return Array.isArray(data?.entries) ? data.entries : [];
}

/** Append new entries to the ledger (server-side INSERT, no read-modify-write). */
async function postEntries(
  ssuId: string,
  tribeId: string,
  entries: Omit<LedgerEntry, "id" | "timestamp">[],
): Promise<void> {
  await fetch(buildUrl(ssuId, tribeId), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ entries }),
  });
}

/** React Query hook for reading ledger + logging events. */
export function useLedger(ssuId: string, tribeId: string) {
  const qc = useQueryClient();
  const qk = ["ledger", ssuId, tribeId];

  const { data, isLoading } = useQuery({
    queryKey: qk,
    queryFn: () => fetchLedger(ssuId, tribeId),
    enabled: !!ssuId,
    staleTime: 5_000,
  });

  const entries = data ?? [];

  async function logEvent(entry: Omit<LedgerEntry, "id" | "timestamp">) {
    await postEntries(ssuId, tribeId, [entry]);
    qc.invalidateQueries({ queryKey: qk });
  }

  return { entries, loading: isLoading, logEvent };
}

/** Standalone function for logging from contexts (fire-and-forget). */
export async function appendLedgerEntries(
  ssuId: string,
  tribeId: string,
  newEntries: Omit<LedgerEntry, "id" | "timestamp">[],
): Promise<void> {
  if (newEntries.length === 0) return;
  await postEntries(ssuId, tribeId, newEntries);
}
