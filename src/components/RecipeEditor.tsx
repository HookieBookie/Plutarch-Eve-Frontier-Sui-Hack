import { useState } from "react";
import { useRecipes } from "../hooks/useRecipes";
import {
  getAllRecipes,
  type ConstructionRow,
  type IndustryRow,
  type RefiningRow,
  type GatherRow,
} from "../data/supplyChain";

type Tab = "buildings" | "manufacturing" | "refining" | "gather";

export function RecipeEditor() {
  const { recipes, save, saving } = useRecipes();
  const [tab, setTab] = useState<Tab>("buildings");

  // All recipes (default + custom) for display
  const all = getAllRecipes();

  /* ---- Building form state ---- */
  const [bName, setBName] = useState("");
  const [bComponents, setBComponents] = useState<{ name: string; qty: number }[]>([
    { name: "", qty: 1 },
  ]);

  /* ---- Manufacturing form state ---- */
  const [mOutput, setMOutput] = useState("");
  const [mOutputQty, setMOutputQty] = useState(1);
  const [mInputs, setMInputs] = useState<{ name: string; qty: number }[]>([
    { name: "", qty: 1 },
  ]);

  /* ---- Refining form state ---- */
  const [rInput, setRInput] = useState("");
  const [rInputQty, setRInputQty] = useState(1);
  const [rOutput, setROutput] = useState("");
  const [rOutputQty, setROutputQty] = useState(1);

  /* ---- Gather form state ---- */
  const [gItem, setGItem] = useState("");

  /* ---- Helpers ---- */
  function addComponentRow() {
    setBComponents([...bComponents, { name: "", qty: 1 }]);
  }

  function addMfgInputRow() {
    setMInputs([...mInputs, { name: "", qty: 1 }]);
  }

  function updateMfgInput(idx: number, field: "name" | "qty", value: string | number) {
    const next = [...mInputs];
    if (field === "name") next[idx] = { ...next[idx], name: value as string };
    else next[idx] = { ...next[idx], qty: Number(value) || 1 };
    setMInputs(next);
  }

  function removeMfgInput(idx: number) {
    setMInputs(mInputs.filter((_, i) => i !== idx));
  }

  function updateComponent(idx: number, field: "name" | "qty", value: string | number) {
    const next = [...bComponents];
    if (field === "name") next[idx] = { ...next[idx], name: value as string };
    else next[idx] = { ...next[idx], qty: Number(value) || 1 };
    setBComponents(next);
  }

  function removeComponent(idx: number) {
    setBComponents(bComponents.filter((_, i) => i !== idx));
  }

  async function addBuilding() {
    if (!bName.trim() || bComponents.every((c) => !c.name.trim())) return;
    const rows: ConstructionRow[] = bComponents
      .filter((c) => c.name.trim())
      .map((c) => ({ building: bName.trim(), component: c.name.trim(), qty: c.qty }));
    const updated = { ...recipes, construction: [...recipes.construction, ...rows] };
    await save(updated);
    setBName("");
    setBComponents([{ name: "", qty: 1 }]);
  }

  async function addManufacturing() {
    if (!mOutput.trim() || mInputs.every((inp) => !inp.name.trim())) return;
    const rows: IndustryRow[] = mInputs
      .filter((inp) => inp.name.trim())
      .map((inp) => ({
        outputItem: mOutput.trim(),
        outputQty: mOutputQty,
        inputItem: inp.name.trim(),
        inputQty: inp.qty,
      }));
    await save({ ...recipes, industry: [...recipes.industry, ...rows] });
    setMOutput("");
    setMOutputQty(1);
    setMInputs([{ name: "", qty: 1 }]);
  }

  async function addRefining() {
    if (!rInput.trim() || !rOutput.trim()) return;
    const row: RefiningRow = {
      inputItem: rInput.trim(),
      inputQty: rInputQty,
      outputItem: rOutput.trim(),
      outputQty: rOutputQty,
    };
    await save({ ...recipes, refining: [...recipes.refining, ...[row]] });
    setRInput("");
    setRInputQty(1);
    setROutput("");
    setROutputQty(1);
  }

  async function removeCustomConstruction(building: string) {
    const updated = {
      ...recipes,
      construction: recipes.construction.filter((r) => r.building !== building),
    };
    await save(updated);
  }

  async function removeCustomIndustryGroup(outputItem: string, outputQty: number) {
    const updated = {
      ...recipes,
      industry: recipes.industry.filter(
        (r) => !(r.outputItem === outputItem && r.outputQty === outputQty),
      ),
    };
    await save(updated);
  }

  async function removeCustomRefining(idx: number) {
    const updated = {
      ...recipes,
      refining: recipes.refining.filter((_, i) => i !== idx),
    };
    await save(updated);
  }

  async function addGather() {
    if (!gItem.trim()) return;
    const row: GatherRow = { item: gItem.trim() };
    await save({ ...recipes, gather: [...(recipes.gather ?? []), row] });
    setGItem("");
  }

  async function removeCustomGather(idx: number) {
    const updated = {
      ...recipes,
      gather: (recipes.gather ?? []).filter((_, i) => i !== idx),
    };
    await save(updated);
  }

  // Group buildings for display
  const buildingMap = new Map<string, { component: string; qty: number; custom: boolean }[]>();
  for (const r of all.construction) {
    if (!buildingMap.has(r.building)) buildingMap.set(r.building, []);
    const isCustom = recipes.construction.some(
      (c) => c.building === r.building && c.component === r.component && c.qty === r.qty,
    );
    buildingMap.get(r.building)!.push({ component: r.component, qty: r.qty, custom: isCustom });
  }

  // Group manufacturing recipes by output for display
  const mfgMap = new Map<string, { output: string; outputQty: number; source?: string; inputs: { name: string; qty: number; custom: boolean }[] }>();
  for (const r of all.industry) {
    const key = `${r.outputItem}|${r.outputQty}|${r.source ?? ""}`;
    if (!mfgMap.has(key)) {
      mfgMap.set(key, { output: r.outputItem, outputQty: r.outputQty, source: r.source, inputs: [] });
    }
    const isCustom = recipes.industry.some(
      (c) => c.outputItem === r.outputItem && c.outputQty === r.outputQty && c.inputItem === r.inputItem && c.inputQty === r.inputQty && (c.source ?? "") === (r.source ?? ""),
    );
    mfgMap.get(key)!.inputs.push({ name: r.inputItem, qty: r.inputQty, custom: isCustom });
  }

  return (
    <div className="recipe-editor">
      <div className="recipe-tabs">
        <button
          className={`recipe-tab${tab === "buildings" ? " active" : ""}`}
          onClick={() => setTab("buildings")}
        >
          Buildings
        </button>
        <button
          className={`recipe-tab${tab === "manufacturing" ? " active" : ""}`}
          onClick={() => setTab("manufacturing")}
        >
          Manufacturing
        </button>
        <button
          className={`recipe-tab${tab === "refining" ? " active" : ""}`}
          onClick={() => setTab("refining")}
        >
          Refining
        </button>
        <button
          className={`recipe-tab${tab === "gather" ? " active" : ""}`}
          onClick={() => setTab("gather")}
        >
          Gather
        </button>
      </div>

      {/* ---- Buildings tab ---- */}
      {tab === "buildings" && (
        <div className="recipe-section">
          <div className="recipe-list">
            {[...buildingMap.entries()].map(([name, comps]) => {
              const allCustom = comps.every((c) => c.custom);
              return (
                <div key={name} className="recipe-row">
                  <div className="recipe-row-header">
                    <span className="recipe-name">{name}</span>
                    {allCustom && (
                      <button
                        className="recipe-delete"
                        onClick={() => removeCustomConstruction(name)}
                        title="Remove building"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="recipe-components">
                    {comps.map((c, i) => (
                      <span key={i} className="recipe-comp">
                        {c.qty}× {c.component}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            {buildingMap.size === 0 && (
              <p className="muted">No buildings defined yet.</p>
            )}
          </div>

          <div className="recipe-form">
            <h4>Add Building</h4>
            <input
              type="text"
              placeholder="Building name (e.g. Smart Turret)"
              value={bName}
              onChange={(e) => setBName(e.target.value)}
            />
            {bComponents.map((c, i) => (
              <div key={i} className="recipe-comp-row">
                <input
                  type="text"
                  placeholder="Component name"
                  value={c.name}
                  onChange={(e) => updateComponent(i, "name", e.target.value)}
                />
                <input
                  type="number"
                  min={1}
                  value={c.qty}
                  onChange={(e) => updateComponent(i, "qty", e.target.value)}
                  style={{ width: "5rem" }}
                />
                {bComponents.length > 1 && (
                  <button className="recipe-delete" onClick={() => removeComponent(i)}>
                    ×
                  </button>
                )}
              </div>
            ))}
            <div className="recipe-form-actions">
              <button className="btn-secondary" onClick={addComponentRow}>
                + Component
              </button>
              <button className="btn-primary" disabled={saving} onClick={addBuilding}>
                {saving ? "Saving…" : "Add Building"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Manufacturing tab ---- */}
      {tab === "manufacturing" && (
        <div className="recipe-section">
          <div className="recipe-list">
            {[...mfgMap.entries()].map(([key, group]) => {
              const allCustom = group.inputs.every((inp) => inp.custom);
              return (
                <div key={key} className="recipe-row">
                  <div className="recipe-row-header">
                    <span className="recipe-name">
                      {group.outputQty}× {group.output}
                      {group.source ? ` (${group.source})` : ""}
                    </span>
                    {allCustom && (
                      <button
                        className="recipe-delete"
                        onClick={() => removeCustomIndustryGroup(group.output, group.outputQty)}
                        title="Remove recipe"
                      >
                        ×
                      </button>
                    )}
                  </div>
                  <div className="recipe-components">
                    {group.inputs.map((inp, i) => (
                      <span key={i} className="recipe-comp">
                        {inp.qty}× {inp.name}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
            {mfgMap.size === 0 && (
              <p className="muted">No manufacturing recipes defined yet.</p>
            )}
          </div>

          <div className="recipe-form">
            <h4>Add Manufacturing Recipe</h4>
            {mInputs.map((inp, i) => (
              <div key={i} className="recipe-comp-row">
                <input
                  type="text"
                  placeholder="Input material"
                  value={inp.name}
                  onChange={(e) => updateMfgInput(i, "name", e.target.value)}
                />
                <input
                  type="number"
                  min={1}
                  value={inp.qty}
                  onChange={(e) => updateMfgInput(i, "qty", e.target.value)}
                  style={{ width: "5rem" }}
                />
                {mInputs.length > 1 && (
                  <button className="recipe-delete" onClick={() => removeMfgInput(i)}>
                    ×
                  </button>
                )}
              </div>
            ))}
            <div className="recipe-arrow">↓ produces</div>
            <div className="recipe-comp-row">
              <input
                type="text"
                placeholder="Output material"
                value={mOutput}
                onChange={(e) => setMOutput(e.target.value)}
              />
              <input
                type="number"
                min={1}
                value={mOutputQty}
                onChange={(e) => setMOutputQty(Number(e.target.value) || 1)}
                style={{ width: "5rem" }}
              />
            </div>
            <div className="recipe-form-actions">
              <button className="btn-secondary" onClick={addMfgInputRow}>
                + Input
              </button>
              <button className="btn-primary" disabled={saving} onClick={addManufacturing}>
                {saving ? "Saving…" : "Add Recipe"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Refining tab ---- */}
      {tab === "refining" && (
        <div className="recipe-section">
          <div className="recipe-list">
            {all.refining.map((r, i) => {
              const customIdx = i - (all.refining.length - recipes.refining.length);
              const isCustom = customIdx >= 0;
              return (
                <div key={i} className="recipe-row recipe-row-inline">
                  <span className="recipe-io">
                    {r.inputQty}× {r.inputItem} → {r.outputQty}× {r.outputItem}
                  </span>
                  {isCustom && (
                    <button
                      className="recipe-delete"
                      onClick={() => removeCustomRefining(customIdx)}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          <div className="recipe-form">
            <h4>Add Refining Recipe</h4>
            <div className="recipe-comp-row">
              <input
                type="text"
                placeholder="Input material"
                value={rInput}
                onChange={(e) => setRInput(e.target.value)}
              />
              <input
                type="number"
                min={1}
                value={rInputQty}
                onChange={(e) => setRInputQty(Number(e.target.value) || 1)}
                style={{ width: "5rem" }}
              />
            </div>
            <div className="recipe-arrow">↓ refines into</div>
            <div className="recipe-comp-row">
              <input
                type="text"
                placeholder="Output material"
                value={rOutput}
                onChange={(e) => setROutput(e.target.value)}
              />
              <input
                type="number"
                min={1}
                value={rOutputQty}
                onChange={(e) => setROutputQty(Number(e.target.value) || 1)}
                style={{ width: "5rem" }}
              />
            </div>
            <div className="recipe-form-actions">
              <button className="btn-primary" disabled={saving} onClick={addRefining}>
                {saving ? "Saving…" : "Add Recipe"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- Gather tab ---- */}
      {tab === "gather" && (
        <div className="recipe-section">
          <div className="recipe-list">
            {all.gather.map((r, i) => {
              const customIdx = i - (all.gather.length - (recipes.gather ?? []).length);
              const isCustom = customIdx >= 0;
              return (
                <div key={i} className="recipe-row recipe-row-inline">
                  <span className="recipe-io">{r.item}</span>
                  {isCustom && (
                    <button
                      className="recipe-delete"
                      onClick={() => removeCustomGather(customIdx)}
                    >
                      ×
                    </button>
                  )}
                </div>
              );
            })}
            {all.gather.length === 0 && (
              <p className="muted">No gather items defined yet.</p>
            )}
          </div>

          <div className="recipe-form">
            <h4>Add Gather Item</h4>
            <div className="recipe-comp-row">
              <input
                type="text"
                placeholder="Raw material name (e.g. Bismuth Crystals)"
                value={gItem}
                onChange={(e) => setGItem(e.target.value)}
                style={{ flex: 1 }}
              />
            </div>
            <div className="recipe-form-actions">
              <button className="btn-primary" disabled={saving} onClick={addGather}>
                {saving ? "Saving…" : "Add Item"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
