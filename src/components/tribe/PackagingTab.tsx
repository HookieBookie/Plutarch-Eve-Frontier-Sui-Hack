import { useState, useMemo } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useQueryClient } from "@tanstack/react-query";
import { useGoals } from "../../context/GoalContext";
import { useCharacter } from "../../hooks/useCharacter";
import { useSsuInventory } from "../../hooks/useSsuInventory";
import { usePackages, type PackageItem } from "../../hooks/usePackages";
import { useAllocations } from "../../hooks/useAllocations";
import { useWings } from "../../hooks/useWings";
import { useEscrowBatch, useEscrowEphBatch, useReleaseBatch, useReleaseEphBatch } from "../../hooks/useEphemeralTransfer";
import { parseFitting, type ParsedFitting } from "../../data/supplyChain";
import { ItemIcon } from "../ItemIcon";
import { Select } from "../Select";

type Mode = "list" | "paste" | "manual";

interface PackagingTabProps {
  isOwner: boolean;
}

export function PackagingTab({ isOwner }: PackagingTabProps) {
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const { ssuId, tribeId } = useGoals();
  const { data: character } = useCharacter(account?.address);
  const { data: ssuInventory } = useSsuInventory(ssuId || undefined);
  const { packages, saving, createPackage, deletePackage, listOnMarket } = usePackages(ssuId, tribeId);
  const { allocatePackage } = useAllocations(ssuId, tribeId);
  const { wings } = useWings(ssuId, tribeId);
  const { escrowBatch } = useEscrowBatch(ssuId || undefined);
  const { escrowEphBatch } = useEscrowEphBatch(ssuId || undefined);
  const { releaseBatch } = useReleaseBatch(ssuId || undefined);
  const { releaseEphBatch } = useReleaseEphBatch(ssuId || undefined);

  const [mode, setMode] = useState<Mode>("list");
  const [fittingText, setFittingText] = useState("");
  const [parsed, setParsed] = useState<ParsedFitting | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [packageName, setPackageName] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Manual bundle state
  const [manualItems, setManualItems] = useState<PackageItem[]>([]);
  const [manualName, setManualName] = useState("");
  const [addItemId, setAddItemId] = useState("");
  const [addItemQty, setAddItemQty] = useState("");

  // Actions state
  const [actionPkg, setActionPkg] = useState<string | null>(null);
  const [actionType, setActionType] = useState<"allocate" | "market" | null>(null);
  const [allocWing, setAllocWing] = useState("");
  const [marketPrice, setMarketPrice] = useState("");

  const mainItems = ssuInventory?.mainItems ?? [];

  // Non-owners use their ephemeral items; owners use main storage
  const myEphemeralItems: { type_id: number; name: string; quantity: number }[] = (() => {
    if (isOwner || !character?.ownerCapId || !ssuInventory) return [];
    return ssuInventory.ephemeralByOwner.get(character.ownerCapId) ?? [];
  })();
  const sourceItems = isOwner ? mainItems : myEphemeralItems;

  // ── Parse fitting ──
  function handleParse() {
    setParseError(null);
    const result = parseFitting(fittingText);
    if (!result) {
      setParseError("Could not parse fitting. Expected format: [ShipType, FittingName] followed by slot sections.");
      return;
    }
    setParsed(result);
    setPackageName(result.fittingName);
  }

  // ── Check inventory availability for parsed items ──
  const availability = useMemo(() => {
    if (!parsed) return [];
    return parsed.items.map((item) => {
      const inv = sourceItems.find((mi) => mi.type_id === item.typeId);
      return {
        ...item,
        available: inv?.quantity ?? 0,
        sufficient: (inv?.quantity ?? 0) >= item.quantity,
      };
    });
  }, [parsed, sourceItems]);

  const allAvailable = availability.length > 0 && availability.every((a) => a.sufficient);

  // ── Create package from fitting ──
  async function handleCreateFromFitting() {
    if (!parsed || !account) return;
    setError(null);
    const name = packageName.trim() || parsed.fittingName;
    const id = `pkg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      // Escrow all items on-chain in a single transaction
      if (character?.objectId && character?.ownerCapId) {
        const escrowItems = parsed.items.filter((it) => it.typeId).map((it) => ({ typeId: it.typeId, quantity: it.quantity }));
        if (escrowItems.length > 0) {
          if (isOwner) {
            await escrowBatch(character.objectId, character.ownerCapId, escrowItems);
          } else {
            await escrowEphBatch(character.objectId, character.ownerCapId, escrowItems);
          }
        }
        queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] });
      }
      await createPackage({
        id,
        name,
        shipType: parsed.shipType,
        fittingText,
        createdBy: account.address,
        items: parsed.items.map((it) => ({
          itemTypeId: it.typeId,
          itemName: it.itemName,
          quantity: it.quantity,
          slotType: it.slotType,
        })),
      });
      setMode("list");
      setFittingText("");
      setParsed(null);
      setPackageName("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // ── Create manual bundle ──
  function handleAddManualItem() {
    const typeId = parseInt(addItemId, 10);
    const qty = parseInt(addItemQty, 10);
    if (!typeId || !qty || qty <= 0) return;
    const inv = sourceItems.find((mi) => mi.type_id === typeId);
    if (!inv) return;
    const existing = manualItems.find((mi) => mi.itemTypeId === typeId);
    if (existing) {
      setManualItems(manualItems.map((mi) =>
        mi.itemTypeId === typeId ? { ...mi, quantity: mi.quantity + qty } : mi,
      ));
    } else {
      setManualItems([...manualItems, {
        itemTypeId: typeId,
        itemName: inv.name,
        quantity: qty,
        slotType: "",
      }]);
    }
    setAddItemId("");
    setAddItemQty("");
  }

  async function handleCreateManual() {
    if (!account || manualItems.length === 0 || !manualName.trim()) return;
    setError(null);
    const id = `pkg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      // Escrow all items on-chain in a single transaction
      if (character?.objectId && character?.ownerCapId) {
        const escrowItems = manualItems.filter((it) => it.itemTypeId).map((it) => ({ typeId: it.itemTypeId, quantity: it.quantity }));
        if (escrowItems.length > 0) {
          if (isOwner) {
            await escrowBatch(character.objectId, character.ownerCapId, escrowItems);
          } else {
            await escrowEphBatch(character.objectId, character.ownerCapId, escrowItems);
          }
        }
        queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] });
      }
      await createPackage({
        id,
        name: manualName.trim(),
        shipType: "",
        fittingText: "",
        createdBy: account.address,
        items: manualItems,
      });
      setMode("list");
      setManualItems([]);
      setManualName("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // ── Delete package ──
  async function handleDelete(pkgId: string) {
    setError(null);
    const pkg = packages.find((p) => p.id === pkgId);
    try {
      // Release all escrowed items back in a single transaction (only if not listed)
      if (pkg && pkg.status !== "listed" && character?.objectId && character?.ownerCapId) {
        const releaseItems = pkg.items.filter((it) => it.itemTypeId).map((it) => ({ typeId: it.itemTypeId, quantity: it.quantity }));
        if (releaseItems.length > 0) {
          if (isOwner) {
            await releaseBatch(character.objectId, character.ownerCapId, releaseItems);
          } else {
            await releaseEphBatch(character.objectId, character.ownerCapId, releaseItems);
          }
        }
        queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] });
      }
      await deletePackage(pkgId);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // ── Allocate to wing ──
  async function handleAllocate(pkgId: string) {
    if (!allocWing || !account) return;
    setError(null);
    const pkg = packages.find((p) => p.id === pkgId);
    if (!pkg) return;
    try {
      await allocatePackage(pkgId, pkg.name, allocWing, account.address);
      // Mark package as allocated
      await fetch(
        `/api/packages?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}&action=update-status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ packageId: pkgId, status: "allocated" }),
        },
      );
      queryClient.invalidateQueries({ queryKey: ["packages"] });
      setActionPkg(null);
      setActionType(null);
      setAllocWing("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // ── List on market ──
  async function handleListOnMarket(pkgId: string) {
    if (!account || !character) return;
    setError(null);
    const price = parseFloat(marketPrice);
    if (!price || price <= 0) {
      setError("Enter a valid price.");
      return;
    }
    const pkg = packages.find((p) => p.id === pkgId);
    if (!pkg) return;

    try {
      // Items are already escrowed from package creation — just create the market order
      await listOnMarket({
        packageId: pkgId,
        wallet: account.address,
        playerName: character.name ?? "Unknown",
        price,
      });
      setActionPkg(null);
      setActionType(null);
      setMarketPrice("");
    } catch (err) {
      setError((err as Error).message);
    }
  }

  // Slot display labels
  const slotLabels: Record<string, string> = {
    hull: "Hull",
    low: "Low Slot",
    med: "Med Slot",
    high: "High Slot",
    engine: "Engine",
    charge: "Charge",
  };

  // ═══════════ Render ═══════════

  return (
    <>
      <div className="panel-header-row">
        <h4>Packages</h4>
        <div style={{ display: "flex", gap: "0.4rem" }}>
          {mode === "list" && (
            <>
              <button className="btn-subtle" style={{ fontSize: "0.7rem" }} onClick={() => setMode("paste")}>
                📋 From Fitting
              </button>
              <button className="btn-subtle" style={{ fontSize: "0.7rem" }} onClick={() => setMode("manual")}>
                ➕ Custom Bundle
              </button>
            </>
          )}
          {mode !== "list" && (
            <button className="btn-subtle" style={{ fontSize: "0.7rem" }} onClick={() => { setMode("list"); setParsed(null); setParseError(null); setError(null); }}>
              ← Back
            </button>
          )}
        </div>
      </div>

      {error && <p className="error" style={{ fontSize: "0.75rem" }}>{error}</p>}

      {/* ── Paste Fitting Mode ── */}
      {mode === "paste" && (
        <div className="alloc-panel" style={{ marginBottom: "1rem" }}>
          <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.4rem" }}>
            Paste a ship fitting from EVE Frontier:
          </p>
          <textarea
            value={fittingText}
            onChange={(e) => setFittingText(e.target.value)}
            placeholder={"[Reflex, My Fitting Name]\nCargo Grid II\n\nHull Repairer\nHop\n\nSmall Cutting Laser\n..."}
            rows={10}
            style={{ width: "100%", fontFamily: "monospace", fontSize: "0.75rem", padding: "0.4rem", background: "var(--bg-input, #1a1a1a)", color: "var(--text, #ccc)", border: "1px solid var(--border, #333)", borderRadius: "4px", resize: "vertical" }}
          />
          {parseError && <p className="error" style={{ fontSize: "0.7rem" }}>{parseError}</p>}
          {!parsed && (
            <button className="btn-subtle" style={{ marginTop: "0.4rem" }} onClick={handleParse} disabled={!fittingText.trim()}>
              Parse Fitting
            </button>
          )}
          {parsed && (
            <div style={{ marginTop: "0.6rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", marginBottom: "0.4rem" }}>
                <strong style={{ fontSize: "0.8rem" }}>📦 {parsed.shipType}</strong>
                <input
                  type="text"
                  value={packageName}
                  onChange={(e) => setPackageName(e.target.value)}
                  placeholder="Package name"
                  style={{ flex: 1, fontSize: "0.75rem" }}
                />
              </div>
              <div className="inventory-list">
                {availability.map((item, i) => (
                  <div key={i} className="inventory-item" style={{ opacity: item.sufficient ? 1 : 0.5 }}>
                    <span className="muted" style={{ fontSize: "0.6rem", minWidth: "3.5rem" }}>
                      {slotLabels[item.slotType] || item.slotType}
                    </span>
                    <ItemIcon typeId={item.typeId} size={18} />
                    <span className="inventory-name">{item.itemName}</span>
                    <span className="inventory-qty">×{item.quantity}</span>
                    <span style={{ fontSize: "0.65rem", color: item.sufficient ? "var(--color-success, #6c6)" : "var(--color-danger, #c66)", marginLeft: "0.3rem" }}>
                      ({item.available} in storage)
                    </span>
                  </div>
                ))}
              </div>
              <div className="alloc-actions" style={{ marginTop: "0.5rem" }}>
                <button className="btn-subtle" onClick={handleCreateFromFitting} disabled={saving || !allAvailable}>
                  {saving ? "Creating…" : allAvailable ? "Create Package" : "Insufficient Items"}
                </button>
                <button className="btn-subtle" onClick={() => setParsed(null)}>Re-parse</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Manual Bundle Mode ── */}
      {mode === "manual" && (
        <div className="alloc-panel" style={{ marginBottom: "1rem" }}>
          <div className="alloc-row">
            <label className="alloc-label">Name</label>
            <input type="text" value={manualName} onChange={(e) => setManualName(e.target.value)} placeholder="Bundle name" style={{ flex: 1 }} />
          </div>
          <div className="alloc-row" style={{ gap: "0.3rem" }}>
            <Select
              value={addItemId}
              onChange={setAddItemId}
              options={[
                { value: "", label: "Select item…" },
                ...sourceItems.map((mi) => ({ value: String(mi.type_id), label: `${mi.name} (×${mi.quantity})` })),
              ]}
            />
            <input type="number" className="alloc-input" value={addItemQty} onChange={(e) => setAddItemQty(e.target.value)} placeholder="Qty" min={1} style={{ width: "4rem" }} />
            <button className="btn-subtle" onClick={handleAddManualItem} disabled={!addItemId || !addItemQty}>+</button>
          </div>
          {manualItems.length > 0 && (
            <div className="inventory-list" style={{ marginTop: "0.4rem" }}>
              {manualItems.map((item, i) => (
                <div key={i} className="inventory-item">
                  <ItemIcon typeId={item.itemTypeId} size={18} />
                  <span className="inventory-name">{item.itemName}</span>
                  <span className="inventory-qty">×{item.quantity}</span>
                  <button className="btn-subtle btn-danger" style={{ fontSize: "0.6rem", marginLeft: "auto" }} onClick={() => setManualItems(manualItems.filter((_, j) => j !== i))}>✕</button>
                </div>
              ))}
            </div>
          )}
          <div className="alloc-actions" style={{ marginTop: "0.5rem" }}>
            <button className="btn-subtle" onClick={handleCreateManual} disabled={saving || manualItems.length === 0 || !manualName.trim()}>
              {saving ? "Creating…" : "Create Bundle"}
            </button>
          </div>
        </div>
      )}

      {/* ── Package List ── */}
      {mode === "list" && (() => {
        const visiblePackages = isOwner
          ? packages
          : packages.filter((p) => p.createdBy === account?.address);
        return (
        <>
          {visiblePackages.length === 0 ? (
            <p className="muted">No packages created yet.</p>
          ) : (
            <div className="inventory-list">
              {visiblePackages.map((pkg) => {
                const isActive = actionPkg === pkg.id;
                const isMine = pkg.createdBy === account?.address;
                return (
                  <div key={pkg.id} className="inventory-item-row">
                    <div className="inventory-item">
                      <span style={{ fontSize: "1rem" }}>📦</span>
                      <span className="inventory-name" style={{ fontWeight: 600 }}>
                        {pkg.name}
                        {pkg.shipType && <span className="muted" style={{ fontWeight: 400, marginLeft: "0.3rem" }}>({pkg.shipType})</span>}
                      </span>
                      <span className="muted" style={{ fontSize: "0.65rem", marginLeft: "0.3rem" }}>
                        {pkg.items.length} item{pkg.items.length !== 1 ? "s" : ""}
                      </span>
                      <span style={{ fontSize: "0.65rem", marginLeft: "0.3rem", color: pkg.status === "listed" ? "var(--color-success, #6c6)" : pkg.status === "allocated" || pkg.status === "sold" ? "var(--color-primary, #69f)" : "var(--text-muted, #888)" }}>
                        {pkg.status}
                      </span>
                      {pkg.status === "created" && (isOwner || isMine) && (
                        <div style={{ marginLeft: "auto", display: "flex", gap: "0.3rem" }}>
                          {isOwner && (
                            <>
                              <button className="btn-subtle" style={{ fontSize: "0.65rem" }}
                                onClick={() => { setActionPkg(isActive ? null : pkg.id); setActionType("allocate"); setAllocWing(""); }}>
                                Allocate
                              </button>
                              <button className="btn-subtle" style={{ fontSize: "0.65rem" }}
                                onClick={() => { setActionPkg(isActive ? null : pkg.id); setActionType("market"); setMarketPrice(""); }}>
                                List
                              </button>
                            </>
                          )}
                          {isMine && (
                            <button className="btn-subtle btn-danger" style={{ fontSize: "0.65rem" }} onClick={() => handleDelete(pkg.id)}>
                              ✕
                            </button>
                          )}
                        </div>
                      )}
                      {pkg.status === "listed" && isMine && (
                        <button className="btn-subtle btn-danger" style={{ marginLeft: "auto", fontSize: "0.65rem" }} onClick={() => handleDelete(pkg.id)}>
                          Cancel
                        </button>
                      )}
                    </div>

                    {/* Package contents */}
                    <div style={{ paddingLeft: "1.5rem", fontSize: "0.7rem" }}>
                      {pkg.items.map((item, j) => (
                        <div key={j} style={{ display: "flex", alignItems: "center", gap: "0.3rem", padding: "1px 0" }}>
                          {item.slotType && <span className="muted" style={{ minWidth: "3rem", fontSize: "0.6rem" }}>{slotLabels[item.slotType] || item.slotType}</span>}
                          <ItemIcon typeId={item.itemTypeId} size={14} />
                          <span>{item.itemName}</span>
                          <span className="muted">×{item.quantity}</span>
                        </div>
                      ))}
                    </div>

                    {/* Allocate action panel */}
                    {isActive && actionType === "allocate" && (
                      <div className="alloc-panel">
                        <div className="alloc-row">
                          <label className="alloc-label">Wing</label>
                          <Select
                            value={allocWing}
                            onChange={setAllocWing}
                            options={[
                              { value: "", label: "Select wing…" },
                              ...wings.map((w) => ({ value: w.id, label: `${w.symbol} ${w.name}` })),
                            ]}
                          />
                        </div>
                        <div className="alloc-actions">
                          <button className="btn-subtle" disabled={!allocWing} onClick={() => handleAllocate(pkg.id)}>
                            Confirm
                          </button>
                          <button className="btn-subtle" onClick={() => { setActionPkg(null); setActionType(null); }}>Cancel</button>
                        </div>
                      </div>
                    )}

                    {/* Market listing action panel */}
                    {isActive && actionType === "market" && (
                      <div className="alloc-panel">
                        <div className="alloc-row">
                          <label className="alloc-label">Price</label>
                          <input
                            type="number"
                            className="alloc-input"
                            value={marketPrice}
                            onChange={(e) => setMarketPrice(e.target.value)}
                            placeholder="Total price"
                            min={1}
                          />
                        </div>
                        <div className="alloc-actions">
                          <button className="btn-subtle" disabled={!marketPrice} onClick={() => handleListOnMarket(pkg.id)}>
                            Escrow &amp; List
                          </button>
                          <button className="btn-subtle" onClick={() => { setActionPkg(null); setActionType(null); }}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </>
        );
      })()}
    </>
  );
}
