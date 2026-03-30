import { useState, useMemo } from "react";
import { useGoals, type GoalType } from "../../context/GoalContext";
import { useLedger, type LedgerEntry } from "../../hooks/useLedger";

type TimeFilter = "all" | "24h" | "7d" | "30d";

function filterByTime(entries: LedgerEntry[], filter: TimeFilter): LedgerEntry[] {
  if (filter === "all") return entries;
  const now = Date.now();
  const ms = filter === "24h" ? 86400e3 : filter === "7d" ? 604800e3 : 2592000e3;
  return entries.filter((e) => now - e.timestamp < ms);
}

function fmtDuration(ms: number): string {
  if (ms < 60000) return `${Math.round(ms / 1000)}s`;
  if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
  const h = Math.floor(ms / 3600000);
  const m = Math.round((ms % 3600000) / 60000);
  return `${h}h ${m}m`;
}

function fmtDate(ts: number): string {
  return new Date(ts).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

/* ---- Derived metrics ---- */

interface GoalTiming {
  goalId: number;
  goalType: GoalType;
  description: string;
  startedAt: number;
  completedAt?: number;
  duration?: number;
}

interface MissionTiming {
  goalId: number;
  missionIdx: number;
  phase: string;
  item: string;
  startedAt: number;
  completedAt?: number;
  duration?: number;
}

interface CycleTiming {
  goalId: number;
  goalType: GoalType;
  description: string;
  cycleNumber: number;
  completedAt: number;
  duration: number;
}

function deriveGoalTimings(entries: LedgerEntry[]): GoalTiming[] {
  const starts = new Map<number, LedgerEntry>();
  const ends = new Map<number, LedgerEntry>();
  for (const e of entries) {
    if (!e.goalId) continue;
    if (e.eventType === "goal_start") starts.set(e.goalId, e);
    if (e.eventType === "goal_complete") ends.set(e.goalId, e);
  }
  const timings: GoalTiming[] = [];
  for (const [id, s] of starts) {
    const c = ends.get(id);
    timings.push({
      goalId: id,
      goalType: s.goalType!,
      description: s.goalDescription ?? "",
      startedAt: s.timestamp,
      completedAt: c?.timestamp,
      duration: c ? c.timestamp - s.timestamp : undefined,
    });
  }
  return timings.sort((a, b) => b.startedAt - a.startedAt);
}

function deriveMissionTimings(entries: LedgerEntry[]): MissionTiming[] {
  const key = (e: LedgerEntry) => `${e.goalId}_${e.missionIdx}`;
  const starts = new Map<string, LedgerEntry>();
  const ends = new Map<string, LedgerEntry>();
  for (const e of entries) {
    if (e.goalId == null || e.missionIdx == null) continue;
    const k = key(e);
    if (e.eventType === "mission_start") starts.set(k, e);
    if (e.eventType === "mission_complete") ends.set(k, e);
  }
  const timings: MissionTiming[] = [];
  for (const [k, s] of starts) {
    const c = ends.get(k);
    timings.push({
      goalId: s.goalId!,
      missionIdx: s.missionIdx!,
      phase: s.missionPhase ?? "",
      item: s.missionItem ?? "",
      startedAt: s.timestamp,
      completedAt: c?.timestamp,
      duration: c ? c.timestamp - s.timestamp : undefined,
    });
  }
  return timings;
}

function deriveCycleTimings(entries: LedgerEntry[]): CycleTiming[] {
  const timings: CycleTiming[] = [];
  // cycle_complete events store the cycle duration in the amount field
  const cyclesByGoal = new Map<number, LedgerEntry[]>();
  for (const e of entries) {
    if (e.eventType === "cycle_complete" && e.goalId != null) {
      const arr = cyclesByGoal.get(e.goalId) ?? [];
      arr.push(e);
      cyclesByGoal.set(e.goalId, arr);
    }
  }
  for (const [goalId, events] of cyclesByGoal) {
    events.sort((a, b) => a.timestamp - b.timestamp);
    events.forEach((e, i) => {
      timings.push({
        goalId,
        goalType: e.goalType!,
        description: e.goalDescription ?? "",
        cycleNumber: i + 1,
        completedAt: e.timestamp,
        duration: e.amount ?? 0,
      });
    });
  }
  return timings;
}

/* ---- Component ---- */

export function AnalyticsTab() {
  const { goals, ssuId, tribeId } = useGoals();
  const { entries, loading } = useLedger(ssuId, tribeId);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("all");
  const [ledgerFilter, setLedgerFilter] = useState("");

  const filtered = useMemo(() => filterByTime(entries, timeFilter), [entries, timeFilter]);
  const goalTimings = useMemo(() => deriveGoalTimings(filtered), [filtered]);
  const missionTimings = useMemo(() => deriveMissionTimings(filtered), [filtered]);
  const cycleTimings = useMemo(() => deriveCycleTimings(filtered), [filtered]);

  /* ---- Ongoing goals ---- */
  const ongoingGoals = goals.filter((g) => g.ongoing);

  /* ---- KPI calculations ---- */
  const totalGoals = goals.length;
  const completedGoals = goals.filter((g) => g.status === "completed").length;
  const publishedGoals = goals.filter((g) => g.status === "published").length;
  const totalBudgetFunded = filtered.filter((e) => e.eventType === "budget_fund").reduce((s, e) => s + (e.amount ?? 0), 0);
  const totalBudgetAllocated = filtered.filter((e) => e.eventType === "budget_allocate").reduce((s, e) => s + (e.amount ?? 0), 0);

  /* Exclude ongoing goals from avg goal time (they never "complete") */
  const ongoingGoalIds = new Set(ongoingGoals.map((g) => g.id));
  const cancelledGoalIds = new Set(goals.filter((g) => g.status === "cancelled").map((g) => g.id));
  const completedTimings = goalTimings.filter((t) => t.duration != null && !ongoingGoalIds.has(t.goalId));
  const avgGoalDuration = completedTimings.length > 0
    ? completedTimings.reduce((s, t) => s + t.duration!, 0) / completedTimings.length : 0;

  /* Budget by goal type */
  const budgetByType = useMemo(() => {
    const map: Record<string, number> = {};
    for (const g of goals) {
      if (g.status === "cancelled") continue;
      map[g.type] = (map[g.type] ?? 0) + g.budget;
    }
    return Object.entries(map).sort((a, b) => b[1] - a[1]);
  }, [goals]);
  const maxBudget = budgetByType.length > 0 ? Math.max(...budgetByType.map(([, v]) => v)) : 1;

  /* Avg completion time by goal type */
  const avgByType = useMemo(() => {
    const groups: Record<string, number[]> = {};
    for (const t of completedTimings) {
      (groups[t.goalType] ??= []).push(t.duration!);
    }
    return Object.entries(groups).map(([type, durations]) => ({
      type,
      avg: durations.reduce((s, d) => s + d, 0) / durations.length,
      count: durations.length,
    }));
  }, [completedTimings]);
  const maxAvg = avgByType.length > 0 ? Math.max(...avgByType.map((a) => a.avg)) : 1;

  /* Throughput: completed missions quantity / time */
  const throughput = useMemo(() => {
    const completedMissions = missionTimings.filter((m) => m.duration != null && m.duration > 0);
    const groups: Record<string, { totalQty: number; totalMs: number; count: number }> = {};
    for (const mt of completedMissions) {
      // Find corresponding mission data from goals
      const goal = goals.find((g) => g.id === mt.goalId);
      const mission = goal?.missions[mt.missionIdx];
      if (!mission) continue;
      const key = `${mt.phase}: ${mt.item}`;
      const g = (groups[key] ??= { totalQty: 0, totalMs: 0, count: 0 });
      g.totalQty += mission.quantity;
      g.totalMs += mt.duration!;
      g.count++;
    }
    return Object.entries(groups)
      .map(([key, v]) => ({ key, rate: v.totalQty / (v.totalMs / 60000), count: v.count, totalQty: v.totalQty }))
      .sort((a, b) => b.rate - a.rate);
  }, [missionTimings, goals]);

  /* Ongoing goal cycle stats */
  const ongoingStats = useMemo(() => {
    const stats: { goalId: number; description: string; goalType: GoalType; totalCycles: number; avgCycleTime: number; minCycleTime: number; maxCycleTime: number }[] = [];
    const grouped = new Map<number, CycleTiming[]>();
    for (const ct of cycleTimings) {
      const arr = grouped.get(ct.goalId) ?? [];
      arr.push(ct);
      grouped.set(ct.goalId, arr);
    }
    for (const [goalId, cycles] of grouped) {
      const durations = cycles.map((c) => c.duration).filter((d) => d > 0);
      if (durations.length === 0) continue;
      stats.push({
        goalId,
        description: cycles[0].description,
        goalType: cycles[0].goalType,
        totalCycles: cycles.length,
        avgCycleTime: durations.reduce((s, d) => s + d, 0) / durations.length,
        minCycleTime: Math.min(...durations),
        maxCycleTime: Math.max(...durations),
      });
    }
    // Also include ongoing goals with cycle counts from goal data but no ledger entries yet
    for (const g of ongoingGoals) {
      if (!grouped.has(g.id) && (g.cycleCount ?? 0) > 0) {
        stats.push({
          goalId: g.id,
          description: g.description,
          goalType: g.type,
          totalCycles: g.cycleCount ?? 0,
          avgCycleTime: 0,
          minCycleTime: 0,
          maxCycleTime: 0,
        });
      }
    }
    return stats;
  }, [cycleTimings, ongoingGoals]);

  /* Ledger table */
  const ledgerRows = useMemo(() => {
    const rows = [...filtered].sort((a, b) => b.timestamp - a.timestamp);
    if (!ledgerFilter) return rows;
    const lf = ledgerFilter.toLowerCase();
    return rows.filter((e) =>
      e.eventType.includes(lf) ||
      (e.goalDescription ?? "").toLowerCase().includes(lf) ||
      (e.missionItem ?? "").toLowerCase().includes(lf)
    );
  }, [filtered, ledgerFilter]);

  if (loading) return <p className="muted">Loading analytics...</p>;

  return (
    <>
      {/* Time filter */}
      <div className="analytics-filters">
        {(["all", "24h", "7d", "30d"] as TimeFilter[]).map((f) => (
          <button key={f} className={`analytics-filter-btn${timeFilter === f ? " active" : ""}`} onClick={() => setTimeFilter(f)}>
            {f === "all" ? "All Time" : f}
          </button>
        ))}
      </div>

      {/* KPI Cards */}
      <div className="kpi-grid">
        <div className="kpi-card">
          <span className="kpi-value">{totalGoals}</span>
          <span className="kpi-label">Total Goals</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-value">{completedGoals}</span>
          <span className="kpi-label">Completed</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-value">{publishedGoals}</span>
          <span className="kpi-label">In Progress</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-value">{avgGoalDuration > 0 ? fmtDuration(avgGoalDuration) : "—"}</span>
          <span className="kpi-label">Avg Goal Time</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-value">{totalBudgetFunded.toLocaleString()}</span>
          <span className="kpi-label">Budget Funded</span>
        </div>
        <div className="kpi-card">
          <span className="kpi-value">{totalBudgetAllocated.toLocaleString()}</span>
          <span className="kpi-label">Budget Allocated</span>
        </div>
      </div>

      {/* Budget by Goal Type */}
      <div className="analytics-panel">
        <h4>Budget Allocation by Type</h4>
        {budgetByType.length === 0 ? (
          <p className="muted">No budget data yet.</p>
        ) : (
          <div className="bar-chart">
            {budgetByType.map(([type, amount]) => (
              <div key={type} className="bar-row">
                <span className="bar-label">{type}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ width: `${(amount / maxBudget) * 100}%` }} />
                </div>
                <span className="bar-value">{amount.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Avg Completion Time by Type */}
      <div className="analytics-panel">
        <h4>Avg Completion Time by Goal Type</h4>
        {avgByType.length === 0 ? (
          <p className="muted">No completed goals yet.</p>
        ) : (
          <div className="bar-chart">
            {avgByType.map((a) => (
              <div key={a.type} className="bar-row">
                <span className="bar-label">{a.type} ({a.count})</span>
                <div className="bar-track">
                  <div className="bar-fill bar-fill-alt" style={{ width: `${(a.avg / maxAvg) * 100}%` }} />
                </div>
                <span className="bar-value">{fmtDuration(a.avg)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Throughput */}
      <div className="analytics-panel">
        <h4>Throughput (items/min)</h4>
        {throughput.length === 0 ? (
          <p className="muted">No completed missions yet.</p>
        ) : (
          <div className="throughput-grid">
            {throughput.slice(0, 12).map((t) => (
              <div key={t.key} className="throughput-card">
                <span className="throughput-value">{t.rate.toFixed(1)}</span>
                <span className="throughput-unit">/ min</span>
                <span className="throughput-label">{t.key}</span>
                <span className="throughput-detail">{t.totalQty.toLocaleString()} total ({t.count} jobs)</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Ongoing Goals */}
      {ongoingGoals.length > 0 && (
        <div className="analytics-panel">
          <h4>Ongoing Goals — Cycle Performance</h4>
          {ongoingStats.length === 0 ? (
            <p className="muted">No cycle completions recorded yet.</p>
          ) : (
            <div className="ledger-table-wrap">
              <table className="ledger-table">
                <thead>
                  <tr>
                    <th>Goal</th>
                    <th>Type</th>
                    <th>Cycles</th>
                    <th>Avg Cycle</th>
                    <th>Min</th>
                    <th>Max</th>
                  </tr>
                </thead>
                <tbody>
                  {ongoingStats.map((s) => (
                    <tr key={s.goalId} className="row-active">
                      <td>{s.description}</td>
                      <td>{s.goalType}</td>
                      <td>{s.totalCycles}</td>
                      <td>{s.avgCycleTime > 0 ? fmtDuration(s.avgCycleTime) : "—"}</td>
                      <td>{s.minCycleTime > 0 ? fmtDuration(s.minCycleTime) : "—"}</td>
                      <td>{s.maxCycleTime > 0 ? fmtDuration(s.maxCycleTime) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Goal Timeline */}
      <div className="analytics-panel">
        <h4>Goal Timeline</h4>
        {goalTimings.length === 0 ? (
          <p className="muted">No goals started yet.</p>
        ) : (
          <div className="ledger-table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Goal</th>
                  <th>Type</th>
                  <th>Started</th>
                  <th>Completed</th>
                  <th>Duration</th>
                </tr>
              </thead>
              <tbody>
                {goalTimings.map((t) => {
                  const isOngoing = ongoingGoalIds.has(t.goalId);
                  const isCancelled = cancelledGoalIds.has(t.goalId);
                  const goal = goals.find((g) => g.id === t.goalId);
                  const cycles = goal?.cycleCount ?? 0;
                  return (
                    <tr key={t.goalId} className={isCancelled ? "row-cancelled" : t.completedAt ? "row-complete" : "row-active"}>
                      <td>{t.description}{isOngoing ? " ♻" : ""}</td>
                      <td>{t.goalType}</td>
                      <td>{fmtDate(t.startedAt)}</td>
                      <td>{isCancelled ? "Cancelled" : isOngoing ? `${cycles} cycles` : t.completedAt ? fmtDate(t.completedAt) : "—"}</td>
                      <td>{isCancelled ? "Cancelled" : isOngoing ? "Ongoing" : t.duration != null ? fmtDuration(t.duration) : "In progress"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Event Ledger */}
      <div className="analytics-panel">
        <h4>Event Ledger</h4>
        <input
          type="text" className="ledger-search" placeholder="Filter events..."
          value={ledgerFilter} onChange={(e) => setLedgerFilter(e.target.value)}
        />
        {ledgerRows.length === 0 ? (
          <p className="muted">No events recorded yet.</p>
        ) : (
          <div className="ledger-table-wrap">
            <table className="ledger-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Event</th>
                  <th>Goal</th>
                  <th>Mission</th>
                  <th>Amount</th>
                </tr>
              </thead>
              <tbody>
                {ledgerRows.slice(0, 100).map((e) => (
                  <tr key={e.id}>
                    <td>{fmtDate(e.timestamp)}</td>
                    <td><span className={`event-badge event-${e.eventType.replace("_", "-")}`}>{e.eventType.replace(/_/g, " ")}</span></td>
                    <td>{e.goalDescription ?? "—"}</td>
                    <td>{e.missionItem ? `${e.missionPhase}: ${e.missionItem}` : "—"}</td>
                    <td>{e.amount != null ? e.amount.toLocaleString() : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {ledgerRows.length > 100 && (
              <p className="muted" style={{ fontSize: "0.7rem", marginTop: "0.5rem" }}>
                Showing first 100 of {ledgerRows.length} events.
              </p>
            )}
          </div>
        )}
      </div>
    </>
  );
}
