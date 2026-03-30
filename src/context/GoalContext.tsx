import {
  createContext,
  useContext,
  useState,
  useEffect,
  useMemo,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { Mission } from "../data/supplyChain";
import { useVaultId } from "../hooks/useVaultId";
import { useVaultData } from "../hooks/useVaultData";
import { appendLedgerEntries } from "../hooks/useLedger";

export type GoalType = "Construct" | "Build" | "Assemble" | "Print" | "Refine" | "Gather" | "Acquire" | "Deliver";
export type GoalStatus = "draft" | "published" | "completed" | "cancelled";

export interface PublishedGoal {
  id: number;
  type: GoalType;
  description: string;
  budget: number;
  tierPercents: [number, number, number];
  missions: Mission[];
  /** Indices of missions that are published (visible to tribe members). */
  publishedMissions: Set<number>;
  /** Completed quantity per mission index. */
  completed: Map<number, number>;
  status: GoalStatus;
  /** Wing IDs assigned per mission index (SSU-local). */
  missionWings: Record<number, string[]>;
  /** Timestamp when the goal was published. */
  startedAt?: number;
  /** Total credits already awarded from this goal's budget. */
  budgetAwarded: number;
  /** If true, this goal repeats indefinitely — cycling when all missions complete. */
  ongoing?: boolean;
  /** Number of completed cycles (only for ongoing goals). */
  cycleCount?: number;
  /** Timestamp when the current cycle started (set after each cycle reset). */
  cycleStartedAt?: number;
  /** Fixed reward per ACQUIRE mission index (manually set by manager). */
  acquireRewards?: Map<number, number>;
  /** Delivery-specific: ID of the linked delivery record. */
  deliveryId?: string;
  /** Delivery-specific: destination SSU assembly ID. */
  destinationSsuId?: string;
  /** Delivery-specific: destination SSU label for display. */
  destinationLabel?: string;
}

/* ---------- Serialisation helpers (Set/Map ↔ JSON) ---------- */

interface SerializedGoal
  extends Omit<PublishedGoal, "publishedMissions" | "completed" | "acquireRewards"> {
  publishedMissions: number[];
  completed: [number, number][];
  acquireRewards?: [number, number][];
}

function serialiseGoals(goals: PublishedGoal[]): SerializedGoal[] {
  return goals.map((g) => ({
    ...g,
    publishedMissions: [...g.publishedMissions],
    completed: [...g.completed.entries()],
    acquireRewards: g.acquireRewards ? [...g.acquireRewards.entries()] : undefined,
  }));
}

function deserialiseGoals(raw: SerializedGoal[]): PublishedGoal[] {
  return raw.map((g) => ({
    ...g,
    publishedMissions: new Set(g.publishedMissions),
    completed: new Map(g.completed),
    missionWings: (g as unknown as PublishedGoal).missionWings ?? {},
    startedAt: (g as unknown as PublishedGoal).startedAt,
    budgetAwarded: (g as unknown as PublishedGoal).budgetAwarded ?? 0,
    ongoing: (g as unknown as PublishedGoal).ongoing ?? false,
    cycleCount: (g as unknown as PublishedGoal).cycleCount ?? 0,
    cycleStartedAt: (g as unknown as PublishedGoal).cycleStartedAt,
    acquireRewards: g.acquireRewards ? new Map(g.acquireRewards) : undefined,
  }));
}

/* ---------- API helpers ---------- */

async function loadGoals(ssuId: string, tribeId: string): Promise<SerializedGoal[]> {
  const res = await fetch(`/api/goals?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data?.goals ?? [];
}

async function saveGoals(ssuId: string, tribeId: string, goals: SerializedGoal[]): Promise<void> {
  await fetch(`/api/goals?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goals }),
  });
}

/* ---------- Context ---------- */

interface GoalContextValue {
  goals: PublishedGoal[];
  budgetPool: number;
  depositedBudget: number;
  onChainBudget: number;
  loading: boolean;
  tribeId: string;
  ssuId: string;
  addGoal: (goal: Omit<PublishedGoal, "completed" | "status" | "missionWings" | "startedAt" | "budgetAwarded" | "cycleCount" | "cycleStartedAt">) => void;
  updateGoal: (id: number, patch: Partial<PublishedGoal>) => void;
  publishGoal: (id: number) => void;
  cancelGoal: (id: number) => void;
  completeMission: (goalId: number, missionIdx: number, qty: number, reward?: number) => void;
  /** Re-fetch goals from the server (e.g. after server-side delivery completion). */
  refetchGoals: () => void;
}

const GoalContext = createContext<GoalContextValue | null>(null);

export function GoalProvider({ tribeId, ssuId, children }: { tribeId: string; ssuId: string; children: ReactNode }) {
  const [goals, setGoals] = useState<PublishedGoal[]>([]);
  const [loading, setLoading] = useState(true);
  const goalSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ssuIdRef = useRef(ssuId);
  const tribeIdRef = useRef(tribeId);
  ssuIdRef.current = ssuId;
  tribeIdRef.current = tribeId;

  /* Budget deposited by this SSU (from network settings) */
  const [depositedBudget, setDepositedBudget] = useState(0);

  useEffect(() => {
    if (!ssuId || !tribeId) return;
    fetch(`/api/network-settings?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`)
      .then((r) => r.json())
      .then((data) => {
        setDepositedBudget(Number(data.localBudget) || 0);
      })
      .catch(() => {});
  }, [ssuId, tribeId]);

  /* On-chain budget from the vault's credit_budget field */
  const numericTribeId = Number(tribeId);
  const { data: vaultId } = useVaultId(numericTribeId > 0 ? numericTribeId : undefined);
  const { data: vault } = useVaultData(vaultId);
  const onChainBudget = vault ? Math.floor(vault.creditBudget / 1e9) : 0;

  /* Derive available budget = deposited budget – allocated to active goals */
  const allocatedBudget = useMemo(
    () => goals.filter((g) => g.status !== "cancelled").reduce((s, g) => s + g.budget, 0),
    [goals],
  );
  const budgetPool = Math.max(0, depositedBudget - allocatedBudget);

  /* Debounced save for goals (per SSU) */
  const persistGoals = useCallback(
    (g: PublishedGoal[]) => {
      if (goalSaveTimer.current) clearTimeout(goalSaveTimer.current);
      goalSaveTimer.current = setTimeout(() => {
        saveGoals(ssuIdRef.current, tribeIdRef.current, serialiseGoals(g));
      }, 300);
    },
    [],
  );

  /* Load goals when ssuId changes */
  useEffect(() => {
    setLoading(true);
    setGoals([]);
    loadGoals(ssuId, tribeId)
      .then((raw) => { if (raw) setGoals(deserialiseGoals(raw)); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [ssuId, tribeId]);

  /* Re-fetch goals from the server (used after server-side delivery completion) */
  const refetchGoals = useCallback(() => {
    loadGoals(ssuIdRef.current, tribeIdRef.current)
      .then((raw) => { if (raw) setGoals(deserialiseGoals(raw)); })
      .catch(() => {});
  }, []);

  /* Helpers that set state AND schedule a save */
  function setGoalsAndSave(
    updater: (prev: PublishedGoal[]) => PublishedGoal[],
  ) {
    setGoals((prev) => {
      const next = updater(prev);
      persistGoals(next);
      return next;
    });
  }

  function addGoal(goal: Omit<PublishedGoal, "completed" | "status" | "missionWings" | "startedAt" | "budgetAwarded" | "cycleCount" | "cycleStartedAt">) {
    const cost = goal.budget;
    if (cost > budgetPool) return; // caller must validate
    setGoalsAndSave(
      (prev) => [...prev, { ...goal, completed: new Map(), status: "draft" as GoalStatus, missionWings: {}, budgetAwarded: 0, cycleCount: 0, cycleStartedAt: undefined }],
    );
    // Log budget allocation
    if (goal.budget > 0) {
      appendLedgerEntries(ssuIdRef.current, tribeIdRef.current, [
        { eventType: "budget_allocate", goalId: goal.id, goalType: goal.type, goalDescription: goal.description, amount: goal.budget },
      ]).catch(() => {});
    }
  }

  function updateGoal(id: number, patch: Partial<PublishedGoal>) {
    setGoalsAndSave((prev) =>
      prev.map((g) => (g.id === id ? { ...g, ...patch } : g)),
    );
  }

  function publishGoal(id: number) {
    const goal = goals.find((g) => g.id === id);
    if (!goal) return;
    const now = Date.now();
    setGoalsAndSave((prev) =>
      prev.map((g) => (g.id === id ? { ...g, status: "published" as GoalStatus, startedAt: now, cycleStartedAt: now } : g)),
    );
    // Log goal_start + mission_start for each published mission
    const entries: Parameters<typeof appendLedgerEntries>[2] = [
      { eventType: "goal_start", goalId: id, goalType: goal.type, goalDescription: goal.description, amount: goal.budget },
    ];
    for (const idx of goal.publishedMissions) {
      const m = goal.missions[idx];
      if (!m) continue;
      entries.push({ eventType: "mission_start", goalId: id, goalType: goal.type, goalDescription: goal.description, missionIdx: idx, missionPhase: m.phase, missionItem: m.description });
    }
    appendLedgerEntries(ssuIdRef.current, tribeIdRef.current, entries).catch(() => {});
  }

  function cancelGoal(id: number) {
    const goal = goals.find((g) => g.id === id);
    if (!goal || goal.status === "cancelled") return;
    setGoalsAndSave(
      (prev) =>
        prev.map((g) => (g.id === id ? { ...g, status: "cancelled" as GoalStatus } : g)),
    );
    appendLedgerEntries(ssuIdRef.current, tribeIdRef.current, [
      { eventType: "goal_cancel", goalId: id, goalType: goal.type, goalDescription: goal.description },
    ]).catch(() => {});
  }

  function completeMission(goalId: number, missionIdx: number, qty: number, reward?: number) {
    setGoalsAndSave((prev) =>
      prev.map((g) => {
        if (g.id !== goalId) return g;
        const next = new Map(g.completed);
        const current = next.get(missionIdx) ?? 0;
        const mission = g.missions[missionIdx];
        if (!mission) return g;
        const newQty = Math.min(current + qty, mission.quantity);
        next.set(missionIdx, newQty);
        const newBudgetAwarded = (g.budgetAwarded ?? 0) + (reward ?? 0);

        const ledgerBatch: Parameters<typeof appendLedgerEntries>[2] = [];

        // Log mission_complete when this mission just reached its target
        if (newQty >= mission.quantity && current < mission.quantity) {
          ledgerBatch.push({ eventType: "mission_complete", goalId, goalType: g.type, goalDescription: g.description, missionIdx, missionPhase: mission.phase, missionItem: mission.description });
        }

        // Check if all published missions are now complete
        let allDone = true;
        for (const idx of g.publishedMissions) {
          const m = g.missions[idx];
          if (!m) continue;
          const done = next.get(idx) ?? 0;
          if (done < m.quantity) { allDone = false; break; }
        }

        if (allDone && g.status === "published") {
          if (g.ongoing) {
            // --- Ongoing goal: cycle complete, auto-reset ---
            const now = Date.now();
            const cycleStart = g.cycleStartedAt ?? g.startedAt ?? now;
            const cycleDuration = now - cycleStart;
            const newCycleCount = (g.cycleCount ?? 0) + 1;
            ledgerBatch.push({ eventType: "cycle_complete", goalId, goalType: g.type, goalDescription: g.description, amount: cycleDuration });

            if (ledgerBatch.length > 0) {
              appendLedgerEntries(ssuIdRef.current, tribeIdRef.current, ledgerBatch).catch(() => {});
            }

            // Reset completed map, budget awarded, and start new cycle
            return {
              ...g,
              completed: new Map(),
              status: "published" as GoalStatus,
              budgetAwarded: 0,
              cycleCount: newCycleCount,
              cycleStartedAt: now,
            };
          } else {
            // --- Normal goal: mark completed ---
            ledgerBatch.push({ eventType: "goal_complete", goalId, goalType: g.type, goalDescription: g.description });
          }
        }

        if (ledgerBatch.length > 0) {
          appendLedgerEntries(ssuIdRef.current, tribeIdRef.current, ledgerBatch).catch(() => {});
        }

        return { ...g, completed: next, status: allDone && g.status === "published" ? "completed" as GoalStatus : g.status, budgetAwarded: newBudgetAwarded };
      }),
    );
  }

  return (
    <GoalContext.Provider
      value={{
        goals,
        budgetPool,
        depositedBudget,
        onChainBudget,
        loading,
        tribeId,
        ssuId,
        addGoal,
        updateGoal,
        publishGoal,
        cancelGoal,
        completeMission,
        refetchGoals,
      }}
    >
      {children}
    </GoalContext.Provider>
  );
}

export function useGoals() {
  const ctx = useContext(GoalContext);
  if (!ctx) throw new Error("useGoals must be inside GoalProvider");
  return ctx;
}
