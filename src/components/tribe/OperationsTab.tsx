import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import {
  decomposeConstruct,
  decomposeBuild,
  decomposeAssemble,
  decomposePrint,
  decomposeRefine,
  decomposeGather,
  decomposeAcquire,
  getBuildings,
  getShips,
  getModules,
  getPrintItems,
  getRefineItems,
  getGatherItems,
  getAcquireItems,
  getAvailablePrinters,
  getAvailableRefineries,
  getAvailableBerths,
  getAvailableAssemblers,
  formatSourceLabel,
  computeTieredRewards,
  parseMissionDisplay,
  DEFAULT_TIER_PERCENTS,
  type Mission,
  type StructureFilter,
} from "../../data/supplyChain";
import { ItemIcon, MissionIcon } from "../ItemIcon";
import { useGoals, type GoalType } from "../../context/GoalContext";
import { useWings } from "../../hooks/useWings";
import { useRecipes } from "../../hooks/useRecipes";
import { useTicker } from "../../context/DeploymentContext";
import { Select } from "../Select";
import { useSsuInventory, useSsuOnChainNames, type InventoryItem } from "../../hooks/useSsuInventory";
import { useTerritoryData } from "../../hooks/useTerritoryData";
import { useDeliveryActions, useIncomingDeliveries, type DeliveryItem } from "../../hooks/useDelivery";
import { ssuDisplayName, buildSsuLabel, isLikelyAddress, anonSsuName } from "../../utils/ssuNames";
import { useCurrentAccount } from "@mysten/dapp-kit-react";

export const GOAL_TYPE_LABELS: Record<string, string> = {
  Construct: "🏗 Construct",
  Build: "🚀 Build",
  Assemble: "🔧 Assemble",
  Print: "🖨 Print",
  Refine: "🔥 Refine",
  Gather: "⛏ Gather",
  Acquire: "🎯 Acquire",
  Deliver: "📦 Deliver",
};

let nextId = Date.now();

export function OperationsTab({ isOwner }: { isOwner: boolean }) {
  const {
    goals, budgetPool, loading: goalsLoading,
    addGoal, updateGoal, publishGoal, cancelGoal, ssuId, tribeId,
  } = useGoals();
  const { wings } = useWings(ssuId, tribeId);
  const ticker = useTicker();
  const account = useCurrentAccount();

  useRecipes(); // ensure custom recipes loaded

  // Incoming deliveries targeting this SSU
  const { data: incomingDeliveries } = useIncomingDeliveries(ssuId);
  const { progressDelivery } = useDeliveryActions(ssuId, tribeId);
  const [deliveryActing, setDeliveryActing] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [expandedGoals, setExpandedGoals] = useState<Set<number>>(new Set());
  const [wingDropdown, setWingDropdown] = useState<string | null>(null); // "goalId-missionIdx"
  const [dropdownPos, setDropdownPos] = useState<{ top: number; left: number } | null>(null);
  const wingBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Close dropdown on outside click, scroll, or resize
  useEffect(() => {
    if (!wingDropdown) return;
    function handleClick(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (!target.closest(".wing-dropdown-portal") && !target.closest(".wing-btn")) {
        setWingDropdown(null);
      }
    }
    function handleDismiss() { setWingDropdown(null); }
    document.addEventListener("mousedown", handleClick);
    window.addEventListener("scroll", handleDismiss, true);
    window.addEventListener("resize", handleDismiss);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      window.removeEventListener("scroll", handleDismiss, true);
      window.removeEventListener("resize", handleDismiss);
    };
  }, [wingDropdown]);

  const openWingDropdown = useCallback((key: string) => {
    if (wingDropdown === key) { setWingDropdown(null); return; }
    const btn = wingBtnRefs.current.get(key);
    if (btn) {
      const rect = btn.getBoundingClientRect();
      const dropdownHeight = 200; // estimated max height
      const dropdownWidth = 160;  // min-width from CSS + some buffer
      let top = rect.bottom + 4;
      let left = rect.right;

      // If dropdown would overflow bottom of viewport, show above the button
      if (top + dropdownHeight > window.innerHeight) {
        top = rect.top - dropdownHeight - 4;
      }
      // If dropdown would overflow left side (after translateX(-100%)), shift right
      if (left - dropdownWidth < 0) {
        left = dropdownWidth + 8;
      }

      setDropdownPos({ top, left });
    }
    setWingDropdown(key);
  }, [wingDropdown]);

  const [goalType, setGoalType] = useState<GoalType>("Construct");
  const [selectedItem, setSelectedItem] = useState("");
  const [itemAmount, setItemAmount] = useState(1);
  const [budget, setBudget] = useState(0);
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [ongoing, setOngoing] = useState(false);

  // Delivery-specific state
  const [deliveryDestSsu, setDeliveryDestSsu] = useState("");
  const [deliveryItems, setDeliveryItems] = useState<DeliveryItem[]>([]);
  const [deliveryTimerVal, setDeliveryTimerVal] = useState(1);
  const [deliveryTimerUnit, setDeliveryTimerUnit] = useState<"h" | "d" | "w">("d");
  const { data: ssuInventory } = useSsuInventory(ssuId || undefined);
  const { ssus: territorySSUs } = useTerritoryData(tribeId, account?.address ?? "", ssuId);
  const { createDelivery } = useDeliveryActions(ssuId, tribeId);
  const mainItems: InventoryItem[] = ssuInventory?.mainItems ?? [];

  // Fetch on-chain names for all territory SSUs (for re-resolving stale labels)
  const allOtherSsuIds = useMemo(() => territorySSUs.filter((s) => s.ssuId !== ssuId).map((s) => s.ssuId), [territorySSUs, ssuId]);
  const { data: onChainNames } = useSsuOnChainNames(allOtherSsuIds);

  // Lookup: ssuId → current display name (for re-resolving delivery labels)
  const ssuNameLookup = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of territorySSUs) {
      const coordLabel = buildSsuLabel({ system: s.solarSystemName ?? undefined, pNum: s.pNum, lNum: s.lNum });
      const givenName = onChainNames?.get(s.ssuId);
      // hubName is synced from the blockchain every ~30s — use as fallback when real-time fetch hasn't returned
      const hubGiven = s.hubName && !isLikelyAddress(s.hubName) && s.hubName !== anonSsuName(s.ssuId) ? s.hubName : null;
      const bestName = givenName || hubGiven;
      if (bestName && coordLabel) {
        map.set(s.ssuId, `${bestName} (${coordLabel})`);
      } else if (bestName) {
        map.set(s.ssuId, bestName);
      } else {
        map.set(s.ssuId, coordLabel ?? ssuDisplayName(s));
      }
    }
    return map;
  }, [territorySSUs, onChainNames]);

  // Available destination SSUs (exclude current SSU and SSUs without shared location)
  const destinationOptions = territorySSUs
    .filter((s) => s.ssuId !== ssuId && s.locationGranted)
    .map((s) => ({
      value: s.ssuId,
      label: ssuNameLookup.get(s.ssuId) ?? ssuDisplayName(s),
    }));

  function addDeliveryItem() {
    if (mainItems.length === 0) return;
    const first = mainItems[0];
    setDeliveryItems((prev) => [...prev, { typeId: first.type_id, itemName: first.name || `Item #${first.type_id}`, quantity: 1 }]);
  }

  function removeDeliveryItem(idx: number) {
    setDeliveryItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateDeliveryItem(idx: number, patch: Partial<DeliveryItem>) {
    setDeliveryItems((prev) => prev.map((item, i) => i === idx ? { ...item, ...patch } : item));
  }

  const buildings = getBuildings();
  const ships = getShips();
  const modules = getModules();
  const printItems = getPrintItems();
  const refineItems = getRefineItems();
  const gatherItems = getGatherItems();
  const acquireItems = getAcquireItems();

  // Structure filter state
  const availablePrinters = getAvailablePrinters();
  const availableRefineries = getAvailableRefineries();
  const availableBerths = getAvailableBerths();
  const availableAssemblers = getAvailableAssemblers();
  const [selectedPrinters, setSelectedPrinters] = useState<string[]>([]);
  const [selectedRefineries, setSelectedRefineries] = useState<string[]>([]);
  const [selectedBerths, setSelectedBerths] = useState<string[]>([]);
  const [selectedAssemblers, setSelectedAssemblers] = useState<string[]>([]);

  const structureFilter: StructureFilter | undefined =
    (selectedPrinters.length > 0 || selectedRefineries.length > 0 || selectedBerths.length > 0 || selectedAssemblers.length > 0)
      ? { printers: selectedPrinters.length > 0 ? selectedPrinters : undefined, refineries: selectedRefineries.length > 0 ? selectedRefineries : undefined, berths: selectedBerths.length > 0 ? selectedBerths : undefined, assemblers: selectedAssemblers.length > 0 ? selectedAssemblers : undefined }
      : undefined;

  function togglePrinter(source: string) {
    setSelectedPrinters((prev) => prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source]);
  }
  function toggleRefinery(source: string) {
    setSelectedRefineries((prev) => prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source]);
  }
  function toggleBerth(source: string) {
    setSelectedBerths((prev) => prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source]);
  }
  function toggleAssembler(source: string) {
    setSelectedAssemblers((prev) => prev.includes(source) ? prev.filter((s) => s !== source) : [...prev, source]);
  }

  function getItemsForType(type: GoalType): string[] {
    switch (type) {
      case "Construct": return buildings;
      case "Build": return ships;
      case "Assemble": return modules;
      case "Print": return printItems;
      case "Refine": return refineItems;
      case "Gather": return gatherItems;
      case "Acquire": return acquireItems;
      case "Deliver": return []; // Items selected from inventory, not from a list
    }
  }

  const activeGoals = goals.filter((g) => g.status !== "cancelled");
  const cancelledGoals = goals.filter((g) => g.status === "cancelled");

  function toggleExpand(id: number) {
    setExpandedGoals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function createGoal() {
    // Special handling for Deliver type
    if (goalType === "Deliver") {
      if (deliveryItems.length === 0) { setBudgetError("Add at least one item to deliver"); return; }
      if (!deliveryDestSsu) { setBudgetError("Select a destination SSU"); return; }
      if (budget > budgetPool) { setBudgetError(`Exceeds available budget (${budgetPool.toLocaleString()} ${ticker} available)`); return; }

      setBudgetError(null);
      const id = nextId++;
      const destSsu = territorySSUs.find((s) => s.ssuId === deliveryDestSsu);
      const destMapLabel = destSsu
        ? (buildSsuLabel({ system: destSsu.solarSystemName ?? undefined, pNum: destSsu.pNum, lNum: destSsu.lNum }) ?? ssuDisplayName(destSsu))
        : deliveryDestSsu.slice(0, 10) + "…";
      const destGivenName = destSsu ? onChainNames?.get(destSsu.ssuId) : undefined;
      const destLabel = destGivenName ? `${destGivenName} (${destMapLabel})` : destMapLabel;
      const itemDescs = deliveryItems.map((i) => `${i.quantity}× ${i.itemName}`).join(", ");
      const description = `Deliver ${itemDescs} → ${destLabel}`;

      // Create delivery missions — one mission per item
      const missions: Mission[] = deliveryItems.map((item) => ({
        phase: "DELIVER" as const,
        tier: 1,
        description: `Deliver ${item.itemName}`,
        quantity: item.quantity,
        typeId: item.typeId,
        isAlternative: false,
        altReason: undefined,
      }));

      addGoal({
        id, type: goalType, description, missions,
        publishedMissions: new Set(missions.map((_, i) => i)),
        budget,
        tierPercents: [...DEFAULT_TIER_PERCENTS],
        ongoing: false,
        deliveryId: undefined, // Will be set when delivery record is created
        destinationSsuId: deliveryDestSsu,
        destinationLabel: destLabel,
      });

      // Create the linked delivery record
      const timerMs = deliveryTimerVal * (deliveryTimerUnit === "h" ? 3_600_000 : deliveryTimerUnit === "d" ? 86_400_000 : 604_800_000);
      createDelivery({
        sourceType: "goal",
        sourceId: String(id),
        destinationSsuId: deliveryDestSsu,
        destinationTribeId: tribeId,
        destinationLabel: destLabel,
        items: deliveryItems,
        timerMs,
      }).catch((e) => console.error("[delivery] Failed to create:", e));

      setExpandedGoals((prev) => new Set(prev).add(id));
      setDeliveryItems([]);
      setDeliveryDestSsu("");
      setBudget(0);
      setShowCreate(false);
      return;
    }

    if (!selectedItem) return;
    const amount = Math.max(1, itemAmount);
    let missions: Mission[];

    switch (goalType) {
      case "Construct": missions = decomposeConstruct(selectedItem, amount, structureFilter); break;
      case "Build": missions = decomposeBuild(selectedItem, amount, structureFilter); break;
      case "Assemble": missions = decomposeAssemble(selectedItem, amount, structureFilter); break;
      case "Print": missions = decomposePrint(selectedItem, amount, structureFilter); break;
      case "Refine": missions = decomposeRefine(selectedItem, amount, structureFilter); break;
      case "Gather": missions = decomposeGather(selectedItem, amount); break;
      case "Acquire": missions = decomposeAcquire(selectedItem, amount); break;
    }

    const description = amount > 1 ? `${amount}x ${selectedItem}` : selectedItem;
    if (budget > budgetPool) {
      setBudgetError(`Exceeds available budget (${budgetPool.toLocaleString()} ${ticker} available)`);
      return;
    }

    setBudgetError(null);
    const id = nextId++;
    addGoal({
      id, type: goalType, description, missions,
      publishedMissions: new Set(missions.map((m, i) => (m.isAlternative ? -1 : i)).filter((i) => i >= 0)),
      budget,
      tierPercents: [...DEFAULT_TIER_PERCENTS],
      ongoing,
    });
    setExpandedGoals((prev) => new Set(prev).add(id));
    setItemAmount(1);
    setBudget(0);
    setOngoing(false);
    setShowCreate(false);
  }

  function toggleMission(goalId: number, missionIdx: number) {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    const next = new Set(goal.publishedMissions);
    if (next.has(missionIdx)) next.delete(missionIdx);
    else next.add(missionIdx);
    updateGoal(goalId, { publishedMissions: next });
  }

  function handleTierChange(goalId: number, tierIdx: number, value: number) {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    const next: [number, number, number] = [goal.tierPercents[0], goal.tierPercents[1], goal.tierPercents[2]];
    next[tierIdx] = value;
    updateGoal(goalId, { tierPercents: next });
  }

  function handleAcquireReward(goalId: number, missionIdx: number, value: number) {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    const next = new Map(goal.acquireRewards ?? new Map());
    if (value > 0) next.set(missionIdx, value);
    else next.delete(missionIdx);
    updateGoal(goalId, { acquireRewards: next });
  }

  function toggleWingAssign(goalId: number, missionIdx: number, wingId: string) {
    const goal = goals.find((g) => g.id === goalId);
    if (!goal) return;
    const current = goal.missionWings[missionIdx] ?? [];
    const updated = current.includes(wingId)
      ? current.filter((id) => id !== wingId)
      : [...current, wingId];
    updateGoal(goalId, { missionWings: { ...goal.missionWings, [missionIdx]: updated } });
  }



  return (
    <>
      <div className="panel-header-row" style={{ marginBottom: "0.75rem" }}>
        <h3>Goals & Missions</h3>
        {isOwner && (
        <button className="btn-primary" onClick={() => setShowCreate(!showCreate)}>
          {showCreate ? "Cancel" : "Create Goal"}
        </button>
        )}
      </div>

      {isOwner && showCreate && (
        <div className="create-goal-form">
          <div className="input-row">
            <Select
              value={goalType}
              onChange={(v) => { const t = v as GoalType; setGoalType(t); setSelectedItem(getItemsForType(t)[0] ?? ""); }}
              options={Object.entries(GOAL_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            />
            {goalType !== "Deliver" && (
            <>
            <Select
              value={selectedItem || (getItemsForType(goalType)[0] ?? "")}
              onChange={setSelectedItem}
              options={getItemsForType(goalType).map((it) => ({ value: it, label: it }))}
              style={{ flex: 1 }}
            />
            <input
              type="number" min={1} max={10000} value={itemAmount}
              onChange={(e) => setItemAmount(Math.max(1, Number(e.target.value) || 1))}
              style={{ width: "5rem", textAlign: "center" }}
              title="Desired amount"
            />
            </>
            )}
            <button className="btn-primary" onClick={createGoal}>Create</button>
          </div>

          {/* ── Delivery-specific form ── */}
          {goalType === "Deliver" && (
            <div style={{ marginTop: "0.5rem", display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              <div className="input-row">
                <label style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>Destination SSU:</label>
                <Select
                  value={deliveryDestSsu}
                  onChange={setDeliveryDestSsu}
                  options={[{ value: "", label: "— Select destination —" }, ...destinationOptions]}
                  style={{ flex: 1 }}
                />
              </div>

              <div style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Items to deliver:</div>
              {deliveryItems.map((item, idx) => (
                <div key={idx} className="input-row" style={{ gap: "0.3rem" }}>
                  <Select
                    value={String(item.typeId)}
                    onChange={(v) => {
                      const typeId = Number(v);
                      const inv = mainItems.find((m) => m.type_id === typeId);
                      updateDeliveryItem(idx, { typeId, itemName: inv?.name || `Item #${typeId}` });
                    }}
                    options={mainItems.map((m) => ({
                      value: String(m.type_id),
                      label: `${m.name || `Item #${m.type_id}`} (${m.quantity} avail)`,
                    }))}
                    style={{ flex: 1 }}
                  />
                  <input
                    type="number" min={1}
                    max={mainItems.find((m) => m.type_id === item.typeId)?.quantity ?? 99999}
                    value={item.quantity}
                    onChange={(e) => updateDeliveryItem(idx, { quantity: Math.max(1, Number(e.target.value) || 1) })}
                    style={{ width: "5rem", textAlign: "center" }}
                    title="Quantity"
                  />
                  <button className="btn-subtle btn-danger" onClick={() => removeDeliveryItem(idx)} style={{ padding: "0.2rem 0.4rem" }}>✕</button>
                </div>
              ))}
              <button className="btn-subtle" onClick={addDeliveryItem} disabled={mainItems.length === 0} style={{ alignSelf: "flex-start" }}>
                + Add Item
              </button>
              {mainItems.length === 0 && <span className="muted" style={{ fontSize: "0.7rem" }}>No items in SSU main inventory</span>}

              <div className="input-row">
                <label style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>Timer per courier:</label>
                <input type="number" min={1} max={deliveryTimerUnit === "h" ? 24 : deliveryTimerUnit === "d" ? 7 : 3} value={deliveryTimerVal}
                  onChange={(e) => setDeliveryTimerVal(Math.max(1, Number(e.target.value) || 1))}
                  style={{ width: "3rem", textAlign: "center" }} />
                <Select value={deliveryTimerUnit} onChange={(v) => { setDeliveryTimerUnit(v as "h"|"d"|"w"); setDeliveryTimerVal(1); }}
                  options={[{ value: "h", label: "hours" }, { value: "d", label: "days" }, { value: "w", label: "weeks" }]} />
              </div>
            </div>
          )}
          {/* Structure filter checkboxes */}
          {(goalType === "Construct" || goalType === "Build" || goalType === "Assemble" || goalType === "Print" || goalType === "Refine") && (
            <div className="structure-filter" style={{ marginTop: "0.5rem" }}>
              {(goalType === "Construct" || goalType === "Build" || goalType === "Assemble" || goalType === "Print") && availablePrinters.length > 0 && (
                <div className="filter-group">
                  <span className="filter-label">Printers:</span>
                  {availablePrinters.map((src) => (
                    <label key={src} className="filter-check">
                      <input type="checkbox" checked={selectedPrinters.includes(src)} onChange={() => togglePrinter(src)} />
                      <span>{formatSourceLabel(src)}</span>
                    </label>
                  ))}
                  {selectedPrinters.length > 0 && (
                    <button className="btn-subtle" style={{ fontSize: "0.65rem", padding: "0 0.3rem" }} onClick={() => setSelectedPrinters([])}>Clear</button>
                  )}
                </div>
              )}
              {availableRefineries.length > 0 && (
                <div className="filter-group">
                  <span className="filter-label">Refineries:</span>
                  {availableRefineries.map((src) => (
                    <label key={src} className="filter-check">
                      <input type="checkbox" checked={selectedRefineries.includes(src)} onChange={() => toggleRefinery(src)} />
                      <span>{formatSourceLabel(src)}</span>
                    </label>
                  ))}
                  {selectedRefineries.length > 0 && (
                    <button className="btn-subtle" style={{ fontSize: "0.65rem", padding: "0 0.3rem" }} onClick={() => setSelectedRefineries([])}>Clear</button>
                  )}
                </div>
              )}
              {goalType === "Build" && availableBerths.length > 0 && (
                <div className="filter-group">
                  <span className="filter-label">Berths:</span>
                  {availableBerths.map((src) => (
                    <label key={src} className="filter-check">
                      <input type="checkbox" checked={selectedBerths.includes(src)} onChange={() => toggleBerth(src)} />
                      <span>{formatSourceLabel(src)}</span>
                    </label>
                  ))}
                  {selectedBerths.length > 0 && (
                    <button className="btn-subtle" style={{ fontSize: "0.65rem", padding: "0 0.3rem" }} onClick={() => setSelectedBerths([])}>Clear</button>
                  )}
                </div>
              )}
              {(goalType === "Build" || goalType === "Assemble") && availableAssemblers.length > 0 && (
                <div className="filter-group">
                  <span className="filter-label">Assemblers:</span>
                  {availableAssemblers.map((src) => (
                    <label key={src} className="filter-check">
                      <input type="checkbox" checked={selectedAssemblers.includes(src)} onChange={() => toggleAssembler(src)} />
                      <span>{formatSourceLabel(src)}</span>
                    </label>
                  ))}
                  {selectedAssemblers.length > 0 && (
                    <button className="btn-subtle" style={{ fontSize: "0.65rem", padding: "0 0.3rem" }} onClick={() => setSelectedAssemblers([])}>Clear</button>
                  )}
                </div>
              )}
              {selectedPrinters.length === 0 && selectedRefineries.length === 0 && selectedBerths.length === 0 && selectedAssemblers.length === 0 && (
                <span className="muted" style={{ fontSize: "0.7rem" }}>No filter — showing all structure recipes</span>
              )}
            </div>
          )}
          <div className="input-row" style={{ marginTop: "0.5rem" }}>
            <label style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>
              Budget ({ticker}):
            </label>
            <input
              type="number" min={0} max={budgetPool} value={budget || ""}
              onChange={(e) => { setBudget(Number(e.target.value) || 0); setBudgetError(null); }}
              placeholder="0"
            />
            <span className="muted" style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
              / {budgetPool.toLocaleString()} available
            </span>
          </div>
          {budgetError && <p className="error">{budgetError}</p>}
          <label className="ongoing-check">
            <input type="checkbox" checked={ongoing} onChange={(e) => setOngoing(e.target.checked)} />
            <span>Ongoing</span>
            <span className="muted" style={{ fontSize: "0.7rem", marginLeft: "0.25rem" }}>(repeats each cycle, budget resets per cycle)</span>
          </label>
        </div>
      )}

      {goalsLoading && <p className="muted">Loading goals...</p>}
      {!goalsLoading && activeGoals.length === 0 && !showCreate && (
        <p className="muted">No goals yet. Create one to get started.</p>
      )}

      {activeGoals.map((goal) => {
        const isExpanded = expandedGoals.has(goal.id);
        const budgetRemaining = Math.max(0, goal.budget - (goal.budgetAwarded ?? 0));
        const rewards = computeTieredRewards(goal.missions, goal.publishedMissions, goal.completed, goal.budget, goal.tierPercents, goal.acquireRewards);
        const tierLabels = ["Gather (T1)", "Refine (T2)", "Print (T3)"];

        return (
          <div key={goal.id} className="goal-card">
            <div className="goal-header goal-header-clickable" onClick={() => toggleExpand(goal.id)}>
              <span className="goal-expand">{isExpanded ? "▼" : "▶"}</span>
              <span className="goal-type">{GOAL_TYPE_LABELS[goal.type] ?? goal.type}</span>
              <span className="goal-desc">{goal.description}</span>
              {goal.type === "Deliver" && goal.destinationSsuId && (
                <span className="goal-ongoing-badge" style={{ background: "rgba(0,180,255,0.15)", color: "#0af" }}>→ {ssuNameLookup.get(goal.destinationSsuId) ?? goal.destinationLabel ?? goal.destinationSsuId.slice(0, 10)}</span>
              )}
              {goal.budget > 0 && <span className="goal-budget">{budgetRemaining.toLocaleString()} / {goal.budget.toLocaleString()} {ticker}{goal.ongoing ? " / cycle" : ""}</span>}
              {goal.ongoing && <span className="goal-ongoing-badge">ONGOING{(goal.cycleCount ?? 0) > 0 ? ` · Cycle ${goal.cycleCount}` : ""}</span>}
              {goal.status === "published" && !goal.ongoing && <span className="goal-published-badge">PUBLISHED</span>}
              {goal.status === "completed" && <span className="goal-completed-badge">COMPLETED</span>}
            </div>

            {isExpanded && (
              <>
                {isOwner && (
                <div className="goal-actions">
                  <button className="btn-primary" onClick={() => publishGoal(goal.id)} disabled={goal.status === "published" || goal.status === "completed"}>
                    {goal.status === "published" || goal.status === "completed" ? "Published ✓" : "Publish"}
                  </button>
                  <button className="btn-cancel" onClick={() => cancelGoal(goal.id)}>Cancel Goal</button>
                  {goal.budget > 0 && <span className="budget-label">Budget: {budgetRemaining.toLocaleString()} / {goal.budget.toLocaleString()} {ticker}</span>}
                </div>
                )}

                {isOwner && goal.budget > 0 && (
                  <div className="tier-sliders">
                    {goal.tierPercents.map((pct, tIdx) => (
                      <div key={tIdx} className="tier-slider-row">
                        <span className="tier-slider-label">{tierLabels[tIdx]}</span>
                        <input type="range" min={0} max={100} value={pct} onChange={(e) => handleTierChange(goal.id, tIdx, Number(e.target.value))} className="tier-slider" />
                        <span className="tier-slider-value">{pct}%</span>
                      </div>
                    ))}
                  </div>
                )}

                {goal.missions.some((m) => m.isAlternative) && (
                  <div className="alt-legend">Solid = default recipe &nbsp;|&nbsp; <span className="alt-legend-faded">Dashed / faded = alternative recipe source (toggle on if you have the facility)</span></div>
                )}
                <div className="rolodex-container">
                  {goal.missions.map((m, i) => {
                    const reward = rewards[i];
                    const done = goal.completed.get(i) ?? 0;
                    const display = parseMissionDisplay(m);
                    const assignedWings = goal.missionWings[i] ?? [];

                    return (
                      <div key={i} className={`rolodex-card phase-${m.phase.toLowerCase()}-card${m.isAlternative ? " mission-alt-card" : ""}`}>
                        <div className="rc-header">
                          <span className={`rc-phase phase-${m.phase.toLowerCase()}`}>{display.title}</span>
                          {done > 0 && <span className="rc-progress">{done}/{m.quantity}</span>}
                          {reward > 0 && <span className="rc-reward">{reward.toLocaleString()} {ticker}</span>}
                        </div>
                        <div className="rc-desc">
                          {display.inputTypeId != null ? (
                            <><MissionIcon typeId={display.inputTypeId} phase="GATHER" size={18} />{display.inputName} → <MissionIcon typeId={display.outputTypeId} phase="REFINE" size={18} />{display.outputName}</>
                          ) : (
                            <><MissionIcon typeId={m.typeId} phase={m.phase} size={18} />{display.desc}</>
                          )}
                        </div>
                        {m.altReason && <div className="rc-alt-reason">Alt: {m.altReason}</div>}
                        <div className="rc-req">{display.requirement}</div>
                        <div className="rc-controls">
                          {isOwner && <>
                          <input type="checkbox" checked={goal.publishedMissions.has(i)} onChange={() => toggleMission(goal.id, i)} />
                          {m.phase === "ACQUIRE" && goal.budget > 0 && (
                            <label className="acquire-reward-input" title="Fixed reward for this ACQUIRE mission">
                              <span>Reward:</span>
                              <input
                                type="number" min={0} max={goal.budget}
                                value={goal.acquireRewards?.get(i) ?? ""}
                                onChange={(e) => handleAcquireReward(goal.id, i, Number(e.target.value) || 0)}
                                placeholder="0"
                                style={{ width: "5rem" }}
                              />
                            </label>
                          )}
                          {wings.length > 0 && (
                            <>
                              <button
                                ref={(el) => { if (el) wingBtnRefs.current.set(`${goal.id}-${i}`, el); }}
                                className={`wing-btn${assignedWings.length > 0 ? " wing-btn-active" : ""}`}
                                onClick={() => openWingDropdown(`${goal.id}-${i}`)}
                              >
                                WING
                              </button>
                              {assignedWings.map((wId) => {
                                const w = wings.find((x) => x.id === wId);
                                if (!w) return null;
                                return <span key={wId} className="wing-tag" style={{ borderColor: w.color, color: w.color }}>{w.name}</span>;
                              })}
                            </>
                          )}
                          </>}
                          {!isOwner && assignedWings.map((wId) => {
                            const w = wings.find((x) => x.id === wId);
                            if (!w) return null;
                            return <span key={wId} className="wing-tag" style={{ borderColor: w.color, color: w.color }}>{w.name}</span>;
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        );
      })}

      {cancelledGoals.length > 0 && (
        <details className="cancelled-section">
          <summary className="muted">Cancelled ({cancelledGoals.length})</summary>
          {cancelledGoals.map((goal) => (
            <div key={goal.id} className="goal-card goal-cancelled">
              <div className="goal-header">
                <span className="goal-type">{goal.type}</span>
                <span className="goal-desc">{goal.description}</span>
                <span className="goal-cancelled-badge">CANCELLED</span>
              </div>
            </div>
          ))}
        </details>
      )}

      {/* ── Incoming Deliveries (items being delivered TO this SSU) ── */}
      {incomingDeliveries && incomingDeliveries.length > 0 && (
        <div style={{ marginTop: "1.5rem" }}>
          <h3 style={{ marginBottom: "0.5rem" }}>📥 Incoming Deliveries</h3>
          {incomingDeliveries.map((del) => {
            const myCourier = del.couriers.find((c) => c.courierWallet === account?.address);
            return (
              <div key={del.id} className="goal-card" style={{ border: "1px solid rgba(100,150,255,0.2)", background: "rgba(100,150,255,0.04)" }}>
                <div className="goal-header">
                  <span className="goal-type" style={{ background: "rgba(100,150,255,0.15)", color: "#7ab3ff" }}>📦 Delivery</span>
                  <span className="goal-desc">
                    {del.items.map((it) => `${it.quantity}× ${it.itemName}`).join(", ")}
                  </span>
                  <span style={{ fontSize: "0.72rem", color: "var(--color-text-muted)" }}>
                    from {ssuNameLookup.get(del.ssuId) ?? `${del.ssuId.slice(0, 8)}…`}
                  </span>
                  <span style={{ fontSize: "0.72rem", padding: "0.15rem 0.4rem", background: "rgba(100,150,255,0.1)", color: "#7ab3ff" }}>
                    {del.status}
                  </span>
                </div>
                {del.collateral > 0 && (
                  <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", padding: "0 0.75rem 0.3rem" }}>
                    Collateral: {del.collateral.toLocaleString()} {ticker}
                  </div>
                )}
                {/* Show each delivery item with deposit progress */}
                <div style={{ padding: "0 0.75rem 0.5rem" }}>
                  {del.items.map((item, idx) => {
                    const deposited = myCourier?.itemsDeposited.find((d) => d.typeId === item.typeId)?.quantity ?? 0;
                    const remaining = item.quantity - deposited;
                    return (
                      <div key={idx} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem", fontSize: "0.78rem" }}>
                        <ItemIcon typeId={item.typeId} size={18} />
                        <span>{item.itemName}</span>
                        <span className="muted">{deposited}/{item.quantity}</span>
                        {deposited >= item.quantity && <span style={{ color: "var(--color-success)", fontSize: "0.7rem" }}>✓</span>}
                        {myCourier && myCourier.status === "in-transit" && remaining > 0 && (
                          <button
                            className="btn-contribute"
                            disabled={!!deliveryActing}
                            style={{ marginLeft: "auto", fontSize: "0.7rem", padding: "0.15rem 0.4rem" }}
                            onClick={async () => {
                              setDeliveryActing(`${del.id}-${item.typeId}`);
                              try {
                                await progressDelivery(del.id, account?.address ?? "", [{ typeId: item.typeId, itemName: item.itemName, quantity: 1 }]);
                              } catch {}
                              setDeliveryActing(null);
                            }}
                          >
                            + Deposit
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}


      {/* Wing dropdown rendered via portal so it escapes overflow:hidden containers */}
      {wingDropdown && dropdownPos && (() => {
        const [gId, mIdx] = wingDropdown.split("-").map(Number);
        const goal = goals.find((g) => g.id === gId);
        const assignedWings = goal?.missionWings[mIdx] ?? [];
        return createPortal(
          <div
            className="wing-dropdown-portal"
            style={{ position: "fixed", top: dropdownPos.top, left: dropdownPos.left, zIndex: 9999, transform: "translateX(-100%)" }}
          >
            <div className="wing-dropdown">
              {wings.map((w) => (
                <button
                  key={w.id}
                  className={`wing-dropdown-item${assignedWings.includes(w.id) ? " wing-dropdown-item-active" : ""}`}
                  onClick={() => toggleWingAssign(gId, mIdx, w.id)}
                >
                  <span className="wing-dot" style={{ background: w.color }} />
                  {w.name}
                  {assignedWings.includes(w.id) && <span className="wing-check">✓</span>}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        );
      })()}
    </>
  );
}
