import { useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useQueryClient } from "@tanstack/react-query";
import { useGoals } from "../../context/GoalContext";
import { useCharacter } from "../../hooks/useCharacter";
import { useSsuInventory } from "../../hooks/useSsuInventory";
import { useAllocations } from "../../hooks/useAllocations";
import { useWings } from "../../hooks/useWings";
import { useReleaseToMain, useReleaseToEphemeral, useEscrowFromMain, useEscrowFromEphemeral, useResetStorage, useReleaseBatch, useReleaseEphBatch } from "../../hooks/useEphemeralTransfer";
import { usePackages } from "../../hooks/usePackages";
import { useMarketOrders } from "../../hooks/useMarketOrders";
import { isStructure, getStructureComponents, getTypeIdByName } from "../../data/supplyChain";
import { ItemIcon } from "../ItemIcon";
import { Select } from "../Select";
import { PackagingTab } from "./PackagingTab";

type InventoryItem = { type_id: number; name: string; quantity: number };

interface StorageTabProps {
  isOwner: boolean;
  isTribeMember: boolean;
}

export function StorageTab({ isOwner, isTribeMember }: StorageTabProps) {
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const { ssuId, tribeId } = useGoals();
  const { data: character } = useCharacter(account?.address);
  const { data: ssuInventory } = useSsuInventory(ssuId || undefined);
  const { allocations, allocate, withdraw: withdrawAllocation, withdrawPackage, saving: allocSaving } = useAllocations(ssuId, tribeId);
  const { wings } = useWings(ssuId, tribeId);
  const { release: releaseToMain, pending: releasePending } = useReleaseToMain(ssuId || undefined);
  const { release: releaseToEphemeral, pending: releaseEphPending } = useReleaseToEphemeral(ssuId || undefined);
  const { escrow: escrowFromMain, pending: escrowPending } = useEscrowFromMain(ssuId || undefined);
  const { escrow: escrowFromEphemeral, pending: escrowEphPending } = useEscrowFromEphemeral(ssuId || undefined);
  const { reset: resetStorage, pending: resetPending } = useResetStorage(ssuId || undefined);
  const { releaseBatch, pending: releaseBatchPending } = useReleaseBatch(ssuId || undefined);
  const { releaseEphBatch, pending: releaseEphBatchPending } = useReleaseEphBatch(ssuId || undefined);
  const { packages } = usePackages(ssuId ?? "", tribeId ?? "");
  const { sellOrders } = useMarketOrders(ssuId ?? "", tribeId ?? "");

  const userAddress = account?.address ?? "";
  const userWingIds = wings.filter((w) => w.memberAddresses.includes(userAddress)).map((w) => w.id);

  // Move from main → corp (owner only)
  const [movingItem, setMovingItem] = useState<InventoryItem | null>(null);
  const [moveQty, setMoveQty] = useState("");
  const [moveError, setMoveError] = useState<string | null>(null);

  // Allocate from corp → wing
  const [allocatingItem, setAllocatingItem] = useState<InventoryItem | null>(null);
  const [allocQty, setAllocQty] = useState("");
  const [allocWing, setAllocWing] = useState("");
  const [allocError, setAllocError] = useState<string | null>(null);

  // Release from corp → main (visible in game UI)
  const [releasingItem, setReleasingItem] = useState<InventoryItem | null>(null);
  const [releaseQty, setReleaseQty] = useState("");
  const [releaseError, setReleaseError] = useState<string | null>(null);

  // Edit allocation
  const [editingAlloc, setEditingAlloc] = useState<string | null>(null);
  const [editQty, setEditQty] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  // Withdraw from wing supply
  const [withdrawingAlloc, setWithdrawingAlloc] = useState<string | null>(null);
  const [withdrawQty, setWithdrawQty] = useState("");
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  // Contribute from ephemeral → corp (non-owner)
  const [contributingItem, setContributingItem] = useState<InventoryItem | null>(null);
  const [contributeQty, setContributeQty] = useState("");
  const [contributeError, setContributeError] = useState<string | null>(null);

  if (!ssuInventory) {
    return <p className="muted">SSU inventory not loaded yet.</p>;
  }

  // User's ephemeral items
  const myItems = character?.ownerCapId
    ? ssuInventory.ephemeralByOwner.get(character.ownerCapId) ?? []
    : [];

  // Wing allocations for this user's wings
  const myAllocations = allocations.filter((a) => userWingIds.includes(a.wingId));

  return (
    <>
      {/* ── Header ── */}
      <div className="panel-header-row">
        <h4>SSU Storage</h4>
        <div style={{ display: "flex", gap: "0.3rem" }}>
          <button
            className="btn-subtle"
            style={{ fontSize: "0.7rem" }}
            title="Refresh SSU inventory"
            onClick={() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] })}
          >
            ↻ Refresh
          </button>
          {isOwner && character?.objectId && ssuInventory.ownerCapId &&
            (ssuInventory.openStorageItems.length > 0 || ssuInventory.allEphemeral.length > 0) && (
              <button
                className="btn-subtle btn-danger"
                style={{ fontSize: "0.7rem" }}
                title="Move all ephemeral & open-storage items back to main inventory"
                disabled={resetPending}
                onClick={async () => {
                  const myCapNorm = character!.ownerCapId.toLowerCase();
                  const myEphItems = ssuInventory.ephemeralByOwner.get(myCapNorm) ?? [];
                  try {
                    await resetStorage(
                      character!.objectId,
                      character!.ownerCapId,
                      myEphItems.map((it) => ({ typeId: it.type_id, quantity: it.quantity })),
                      ssuInventory.openStorageItems.map((it) => ({ typeId: it.type_id, quantity: it.quantity })),
                    );
                    setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
                  } catch (err) {
                    console.error("Reset storage failed:", err);
                  }
                }}
              >
                {resetPending ? "Resetting…" : "⚠ Reset Storage"}
              </button>
            )}
        </div>
      </div>

      {/* ══════════════════════════════════════════════
          Section 1: Main Storage (owner only)
         ══════════════════════════════════════════════ */}
      {isOwner && ssuInventory.mainItems.length > 0 && (
        <>
          <div className="inventory-divider">Main Storage</div>
          <div className="inventory-list">
            {ssuInventory.mainItems.map((item) => {
              const freeInMain = item.quantity;
              const isMoving = movingItem?.type_id === item.type_id;
              if (freeInMain <= 0 && !isMoving) return null;
              return (
                <div key={`main-${item.type_id}`} className="inventory-item-row">
                  <div className="inventory-item">
                    <ItemIcon typeId={item.type_id} size={20} />
                    <span className="inventory-name">{item.name || `Type #${item.type_id}`}</span>
                    <span className="inventory-qty">×{freeInMain.toLocaleString()}</span>
                    {!isMoving && freeInMain > 0 && (
                      <button
                        className="btn-subtle"
                        style={{ marginLeft: "auto", fontSize: "0.7rem" }}
                        onClick={() => {
                          setMovingItem(item);
                          setMoveQty("");
                          setMoveError(null);
                        }}
                      >
                        Move to Corp
                      </button>
                    )}
                  </div>

                  {isMoving && (
                    <div className="alloc-panel">
                      <div className="alloc-row">
                        <label className="alloc-label">Qty</label>
                        <input
                          type="number"
                          className="alloc-input"
                          min={1}
                          max={freeInMain}
                          value={moveQty}
                          onChange={(e) => setMoveQty(e.target.value)}
                          placeholder={`1 – ${freeInMain}`}
                        />
                      </div>
                      {moveError && <p className="error" style={{ fontSize: "0.7rem" }}>{moveError}</p>}
                      <div className="alloc-actions">
                        <button
                          className="btn-subtle"
                          disabled={escrowPending}
                          onClick={async () => {
                            const qty = parseInt(moveQty, 10);
                            if (!qty || qty <= 0 || qty > freeInMain) {
                              setMoveError(`Enter a quantity between 1 and ${freeInMain}.`);
                              return;
                            }
                            try {
                              if (!character?.objectId || !character?.ownerCapId) {
                                setMoveError("Missing character data for on-chain transfer.");
                                return;
                              }
                              // On-chain: move items from main → open (hidden from game UI)
                              const ok = await escrowFromMain(
                                character.objectId,
                                character.ownerCapId,
                                item.type_id,
                                qty,
                              );
                              if (!ok) {
                                setMoveError("On-chain transfer to corp storage failed.");
                                return;
                              }
                              setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
                              setMovingItem(null);
                            } catch (err) {
                              setMoveError((err as Error).message);
                            }
                          }}
                        >
                          {escrowPending ? "Processing…" : "Confirm"}
                        </button>
                        <button className="btn-subtle" onClick={() => setMovingItem(null)}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════
          Section 2: Corporation Storage (tribe members only)
          On-chain open storage = hidden from game UI = corp holding area
         ══════════════════════════════════════════════ */}
      {isTribeMember && (
      <>
      <div className="inventory-divider">Corporation Storage</div>
      {ssuInventory.openStorageItems.length === 0 ? (
        <p className="muted">No items in corporation storage.</p>
      ) : (
        <div className="inventory-list">
          {ssuInventory.openStorageItems.map((item) => {
            const allocated = allocations
              .filter((a) => a.itemTypeId === item.type_id)
              .reduce((s, a) => s + a.quantity, 0);
            // Items locked in active packages (created, listed, or allocated)
            const packaged = packages
              .filter((p) => p.status === "created" || p.status === "listed" || p.status === "allocated")
              .flatMap((p) => p.items)
              .filter((pi) => pi.itemTypeId === item.type_id)
              .reduce((s, pi) => s + pi.quantity, 0);
            // Items locked in active individual sell orders (non-package)
            const onMarket = sellOrders
              .filter((o) => !o.packageId && o.itemTypeId === item.type_id)
              .reduce((s, o) => s + o.quantity, 0);
            // Items locked as components of active structure sell orders
            const onMarketAsComponent = sellOrders
              .filter((o) => !o.packageId && o.itemTypeId !== item.type_id && isStructure(o.itemName))
              .reduce((s, o) => {
                const comps = getStructureComponents(o.itemName);
                const match = comps.find((c) => getTypeIdByName(c.component) === item.type_id);
                return s + (match ? match.qty * o.quantity : 0);
              }, 0);
            const free = item.quantity - allocated - packaged - onMarket - onMarketAsComponent;
            const isAllocating = allocatingItem?.type_id === item.type_id;
            const isReleasing = releasingItem?.type_id === item.type_id;

            return (
              <div key={`corp-${item.type_id}`} className="inventory-item-row">
                <div className="inventory-item">
                  <ItemIcon typeId={item.type_id} size={20} />
                  <span className="inventory-name">{item.name || `Type #${item.type_id}`}</span>
                  <span className="inventory-qty">
                    {free.toLocaleString()} free
                    {allocated > 0 && (
                      <span className="alloc-badge"> / {allocated.toLocaleString()} allocated</span>
                    )}
                    {packaged > 0 && (
                      <span className="alloc-badge"> / {packaged.toLocaleString()} packaged</span>
                    )}
                    {onMarket + onMarketAsComponent > 0 && (
                      <span className="alloc-badge"> / {(onMarket + onMarketAsComponent).toLocaleString()} on market</span>
                    )}
                  </span>
                  <div style={{ marginLeft: "auto", display: "flex", gap: "0.3rem" }}>
                    {isOwner && !isAllocating && !isReleasing && free > 0 && (
                      <>
                        <button
                          className="btn-subtle"
                          style={{ fontSize: "0.7rem" }}
                          onClick={() => {
                            setAllocatingItem(item);
                            setAllocQty("");
                            setAllocWing("");
                            setAllocError(null);
                          }}
                        >
                          Allocate
                        </button>
                        <button
                          className="btn-subtle"
                          style={{ fontSize: "0.7rem" }}
                          onClick={() => {
                            setReleasingItem(item);
                            setReleaseQty("");
                            setReleaseError(null);
                          }}
                        >
                          Release
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Allocate panel: corp → wing */}
                {isAllocating && (
                  <div className="alloc-panel">
                    <div className="alloc-row">
                      <label className="alloc-label">Qty</label>
                      <input
                        type="number"
                        className="alloc-input"
                        min={1}
                        max={free}
                        value={allocQty}
                        onChange={(e) => setAllocQty(e.target.value)}
                        placeholder={`1 – ${free}`}
                      />
                    </div>
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
                    {allocError && <p className="error" style={{ fontSize: "0.7rem" }}>{allocError}</p>}
                    <div className="alloc-actions">
                      <button
                        className="btn-subtle"
                        disabled={allocSaving}
                        onClick={async () => {
                          const qty = parseInt(allocQty, 10);
                          if (!qty || qty <= 0 || qty > free) {
                            setAllocError(`Enter a quantity between 1 and ${free}.`);
                            return;
                          }
                          if (!allocWing) {
                            setAllocError("Select a wing.");
                            return;
                          }
                          try {
                            await allocate(item.type_id, item.name || `Type #${item.type_id}`, allocWing, qty, account?.address ?? "");
                            setAllocatingItem(null);
                          } catch (err) {
                            setAllocError((err as Error).message);
                          }
                        }}
                      >
                        {allocSaving ? "Processing…" : "Confirm"}
                      </button>
                      <button className="btn-subtle" onClick={() => setAllocatingItem(null)}>Cancel</button>
                    </div>
                  </div>
                )}

                {/* Release panel: corp → unclaimed open */}
                {isReleasing && (
                  <div className="alloc-panel">
                    <div className="alloc-row">
                      <label className="alloc-label">Qty</label>
                      <input
                        type="number"
                        className="alloc-input"
                        min={1}
                        max={free}
                        value={releaseQty}
                        onChange={(e) => setReleaseQty(e.target.value)}
                        placeholder={`1 – ${free}`}
                      />
                    </div>
                    {releaseError && <p className="error" style={{ fontSize: "0.7rem" }}>{releaseError}</p>}
                    <div className="alloc-actions">
                      <button
                        className="btn-subtle"
                        disabled={releasePending}
                        onClick={async () => {
                          const qty = parseInt(releaseQty, 10);
                          if (!qty || qty <= 0 || qty > free) {
                            setReleaseError(`Enter a quantity between 1 and ${free}.`);
                            return;
                          }
                          try {
                            if (!character?.objectId || !character?.ownerCapId) {
                              setReleaseError("Missing character data for on-chain transfer.");
                              return;
                            }
                            // On-chain: move items from open → main (visible in game UI)
                            const ok = await releaseToMain(
                              character.objectId,
                              character.ownerCapId,
                              item.type_id,
                              qty,
                            );
                            if (!ok) {
                              setReleaseError("On-chain release to main failed.");
                              return;
                            }
                            setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
                            setReleasingItem(null);
                          } catch (err) {
                            setReleaseError((err as Error).message);
                          }
                        }}
                      >
                        {releasePending ? "Processing…" : "Confirm"}
                      </button>
                      <button className="btn-subtle" onClick={() => setReleasingItem(null)}>Cancel</button>
                    </div>
                    <p className="muted" style={{ fontSize: "0.65rem", marginTop: "0.3rem" }}>
                      Items will be moved back to main storage (visible in game UI).
                    </p>
                  </div>
                )}

                {/* Per-wing allocation breakdown */}
                {allocations
                  .filter((a) => a.itemTypeId === item.type_id)
                  .map((a) => {
                    const wing = wings.find((w) => w.id === a.wingId);
                    const isEditing = editingAlloc === a.id;
                    return (
                      <div key={a.id} className="alloc-detail-row">
                        <div className="alloc-detail">
                          <span
                            className="wing-tag alloc-wing-clickable"
                            style={{ borderColor: wing?.color, color: wing?.color }}
                            title="Click to edit or remove"
                            onClick={() => {
                              if (isEditing) {
                                setEditingAlloc(null);
                              } else {
                                setEditingAlloc(a.id);
                                setEditQty(String(a.quantity));
                                setEditError(null);
                              }
                            }}
                          >
                            {wing?.symbol ?? "?"} {wing?.name ?? a.wingId.slice(0, 6)}
                          </span>
                          <span className="alloc-detail-qty">×{a.quantity.toLocaleString()}</span>
                        </div>

                        {isEditing && (
                          <div className="alloc-panel">
                            <div className="alloc-row">
                              <label className="alloc-label">Qty</label>
                              <input
                                type="number"
                                className="alloc-input"
                                min={0}
                                value={editQty}
                                onChange={(e) => setEditQty(e.target.value)}
                              />
                            </div>
                            {editError && <p className="error" style={{ fontSize: "0.7rem" }}>{editError}</p>}
                            <div className="alloc-actions">
                              <button
                                className="btn-subtle"
                                disabled={allocSaving}
                                onClick={async () => {
                                  const qty = parseInt(editQty, 10);
                                  if (isNaN(qty) || qty < 0) {
                                    setEditError("Enter a valid quantity (0 to remove).");
                                    return;
                                  }
                                  try {
                                    if (qty === 0) {
                                      await withdrawAllocation(a.id, a.quantity);
                                    } else {
                                      const diff = qty - a.quantity;
                                      if (diff > 0) {
                                        if (diff > free) {
                                          setEditError(`Only ${free} free to allocate.`);
                                          return;
                                        }
                                        await allocate(item.type_id, item.name || `Type #${item.type_id}`, a.wingId, diff, account?.address ?? "");
                                      } else if (diff < 0) {
                                        await withdrawAllocation(a.id, -diff);
                                      }
                                    }
                                    setEditingAlloc(null);
                                  } catch (err) {
                                    setEditError((err as Error).message);
                                  }
                                }}
                              >
                                {allocSaving ? "Processing…" : "Save"}
                              </button>
                              <button
                                className="btn-subtle btn-danger"
                                disabled={allocSaving}
                                onClick={async () => {
                                  try {
                                    await withdrawAllocation(a.id, a.quantity);
                                    setEditingAlloc(null);
                                  } catch (err) {
                                    setEditError((err as Error).message);
                                  }
                                }}
                              >
                                {allocSaving ? "…" : "Remove"}
                              </button>
                              <button className="btn-subtle" onClick={() => setEditingAlloc(null)}>Cancel</button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
              </div>
            );
          })}
        </div>
      )}

      {/* Package allocations in Corp Storage */}
      {(() => {
        const pkgAllocs = allocations.filter((a) => !!a.packageId);
        if (pkgAllocs.length === 0) return null;
        return (
          <>
            <div className="inventory-divider" style={{ marginTop: "0.5rem" }}>Package Allocations</div>
            <div className="inventory-list">
              {pkgAllocs.map((a) => {
                const wing = wings.find((w) => w.id === a.wingId);
                const pkg = packages.find((p) => p.id === a.packageId);
                return (
                  <div key={a.id} className="inventory-item-row">
                    <div className="inventory-item">
                      <span className="wing-tag" style={{ borderColor: wing?.color, color: wing?.color }}>
                        {wing?.symbol ?? "?"} {wing?.name ?? a.wingId.slice(0, 6)}
                      </span>
                      <span style={{ fontSize: "1rem" }}>📦</span>
                      <span className="inventory-name" style={{ fontWeight: 600 }}>{a.itemName}</span>
                      {isOwner && (
                        <button
                          className="btn-subtle btn-danger"
                          style={{ marginLeft: "auto", fontSize: "0.65rem" }}
                          disabled={allocSaving}
                          onClick={async () => {
                            try {
                              await withdrawPackage(a.id);
                              // Mark package back to created
                              if (a.packageId) {
                                await fetch(
                                  `/api/packages?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}&action=update-status`,
                                  {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ packageId: a.packageId, status: "created" }),
                                  },
                                );
                                queryClient.invalidateQueries({ queryKey: ["packages"] });
                              }
                            } catch (err) {
                              console.error("Failed to unallocate package:", err);
                            }
                          }}
                        >
                          {allocSaving ? "…" : "Unallocate"}
                        </button>
                      )}
                    </div>
                    {pkg && (
                      <div style={{ paddingLeft: "1.5rem", fontSize: "0.7rem" }}>
                        {pkg.items.map((item, j) => (
                          <div key={j} style={{ display: "flex", alignItems: "center", gap: "0.3rem", padding: "1px 0" }}>
                            <ItemIcon typeId={item.itemTypeId} size={14} />
                            <span>{item.itemName}</span>
                            <span className="muted">×{item.quantity}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        );
      })()}
      </>
      )}

      {/* ══════════════════════════════════════════════
          Section 4: Ephemeral Storage
         ══════════════════════════════════════════════ */}
      <div className="inventory-divider">Ephemeral Storage</div>
      {myItems.length === 0 && myAllocations.length === 0 ? (
        <p className="muted">No ephemeral items.</p>
      ) : (
        <div className="inventory-list">
          {myItems.map((item, i) => {
            const isContributing = contributingItem?.type_id === item.type_id;
            return (
              <div key={`eph-${i}`} className="inventory-item-row">
                <div className="inventory-item">
                  <ItemIcon typeId={item.type_id} size={20} />
                  <span className="inventory-name">{item.name || `Type #${item.type_id}`}</span>
                  <span className="inventory-qty">×{item.quantity.toLocaleString()}</span>
                  {!isOwner && isTribeMember && (
                    <button
                      className="btn-subtle"
                      style={{ marginLeft: "auto", fontSize: "0.65rem" }}
                      onClick={() => {
                        setContributingItem(isContributing ? null : item);
                        setContributeQty("");
                        setContributeError(null);
                      }}
                    >
                      {isContributing ? "Cancel" : "Contribute"}
                    </button>
                  )}
                </div>
                {isContributing && (
                  <div className="alloc-panel">
                    <div className="alloc-row">
                      <label className="alloc-label">Qty</label>
                      <input
                        type="number"
                        className="alloc-input"
                        value={contributeQty}
                        onChange={(e) => setContributeQty(e.target.value)}
                        min={1}
                        max={item.quantity}
                        placeholder={`1–${item.quantity}`}
                      />
                    </div>
                    {contributeError && <p className="error" style={{ fontSize: "0.7rem" }}>{contributeError}</p>}
                    <div className="alloc-actions">
                      <button
                        className="btn-subtle"
                        disabled={escrowEphPending || !contributeQty}
                        onClick={async () => {
                          const qty = parseInt(contributeQty, 10);
                          if (!qty || qty <= 0 || qty > item.quantity) {
                            setContributeError("Invalid quantity");
                            return;
                          }
                          if (!character?.objectId || !character?.ownerCapId) {
                            setContributeError("Character not loaded");
                            return;
                          }
                          try {
                            await escrowFromEphemeral(character.objectId, character.ownerCapId, item.type_id, qty);
                            setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
                            setContributingItem(null);
                            setContributeQty("");
                            setContributeError(null);
                          } catch (err) {
                            setContributeError((err as Error).message);
                          }
                        }}
                      >
                        {escrowEphPending ? "Sending…" : "Confirm"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Wing supplies (from allocations) */}
          {myAllocations.length > 0 && (
            <>
              <div className="inventory-divider" style={{ marginTop: "0.5rem" }}>Wing Supplies</div>
              {myAllocations.filter((a) => !a.packageId).map((a) => {
                const wing = wings.find((w) => w.id === a.wingId);
                const isWithdrawing = withdrawingAlloc === a.id;

                return (
                  <div key={a.id} className="inventory-item-row">
                    <div className="inventory-item">
                      <span className="wing-tag" style={{ borderColor: wing?.color, color: wing?.color }}>
                        {wing?.symbol ?? "?"}
                      </span>
                      <ItemIcon typeId={a.itemTypeId} size={20} />
                      <span className="inventory-name">{a.itemName}</span>
                      <span className="inventory-qty">×{a.quantity.toLocaleString()}</span>
                      {!isWithdrawing && a.quantity > 0 && (
                        <button
                          className="btn-subtle"
                          style={{ marginLeft: "auto", fontSize: "0.7rem" }}
                          onClick={() => {
                            setWithdrawingAlloc(a.id);
                            setWithdrawQty("");
                            setWithdrawError(null);
                          }}
                        >
                          Withdraw
                        </button>
                      )}
                    </div>

                    {isWithdrawing && (
                      <div className="alloc-panel">
                        <div className="alloc-row">
                          <label className="alloc-label">Qty</label>
                          <input
                            type="number"
                            className="alloc-input"
                            min={1}
                            max={a.quantity}
                            value={withdrawQty}
                            onChange={(e) => setWithdrawQty(e.target.value)}
                            placeholder={`1 – ${a.quantity}`}
                          />
                        </div>
                        {withdrawError && <p className="error" style={{ fontSize: "0.7rem" }}>{withdrawError}</p>}
                        <div className="alloc-actions">
                          <button
                            className="btn-subtle"
                            disabled={allocSaving || releasePending || releaseEphPending}
                            onClick={async () => {
                              const qty = parseInt(withdrawQty, 10);
                              if (!qty || qty <= 0 || qty > a.quantity) {
                                setWithdrawError(`Enter a quantity between 1 and ${a.quantity}.`);
                                return;
                              }
                              try {
                                if (!character?.objectId || !character?.ownerCapId || !a.itemTypeId) {
                                  setWithdrawError("Missing character data for on-chain transfer.");
                                  return;
                                }
                                if (isOwner) {
                                  // SSU owner: move items from open → main (visible in game UI)
                                  const ok = await releaseToMain(
                                    character.objectId,
                                    character.ownerCapId,
                                    a.itemTypeId,
                                    qty,
                                  );
                                  if (!ok) {
                                    setWithdrawError("On-chain release to main failed.");
                                    return;
                                  }
                                  setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
                                } else {
                                  // Non-owner: move items from open → caller's ephemeral
                                  const ok = await releaseToEphemeral(
                                    character.objectId,
                                    character.ownerCapId,
                                    a.itemTypeId,
                                    qty,
                                  );
                                  if (!ok) {
                                    setWithdrawError("On-chain transfer failed. Please try again.");
                                    return;
                                  }
                                  setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
                                }
                                await withdrawAllocation(a.id, qty);
                                setWithdrawingAlloc(null);
                              } catch (err) {
                                setWithdrawError((err as Error).message);
                              }
                            }}
                          >
                            {(allocSaving || releasePending || releaseEphPending) ? "Processing…" : "Confirm"}
                          </button>
                          <button className="btn-subtle" onClick={() => setWithdrawingAlloc(null)}>Cancel</button>
                        </div>
                        <p className="muted" style={{ fontSize: "0.65rem", marginTop: "0.3rem" }}>
                          {isOwner
                            ? "Items will be moved to main storage (visible in game UI for withdrawal)."
                            : "Items will be moved to your ephemeral storage on the Stillness network."}
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}

              {/* Package allocations */}
              {myAllocations.filter((a) => !!a.packageId).map((a) => {
                const wing = wings.find((w) => w.id === a.wingId);
                const pkg = packages.find((p) => p.id === a.packageId);
                const isWithdrawing = withdrawingAlloc === a.id;
                const batchPending = releaseBatchPending || releaseEphBatchPending;

                return (
                  <div key={a.id} className="inventory-item-row">
                    <div className="inventory-item">
                      <span className="wing-tag" style={{ borderColor: wing?.color, color: wing?.color }}>
                        {wing?.symbol ?? "?"}
                      </span>
                      <span style={{ fontSize: "1rem" }}>📦</span>
                      <span className="inventory-name" style={{ fontWeight: 600 }}>{a.itemName}</span>
                      {!isWithdrawing && (
                        <button
                          className="btn-subtle"
                          style={{ marginLeft: "auto", fontSize: "0.7rem" }}
                          onClick={() => {
                            setWithdrawingAlloc(a.id);
                            setWithdrawError(null);
                          }}
                        >
                          Withdraw Package
                        </button>
                      )}
                    </div>

                    {/* Package contents */}
                    {pkg && (
                      <div style={{ paddingLeft: "1.5rem", fontSize: "0.7rem" }}>
                        {pkg.items.map((item, j) => (
                          <div key={j} style={{ display: "flex", alignItems: "center", gap: "0.3rem", padding: "1px 0" }}>
                            <ItemIcon typeId={item.itemTypeId} size={14} />
                            <span>{item.itemName}</span>
                            <span className="muted">×{item.quantity}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {isWithdrawing && (
                      <div className="alloc-panel">
                        {withdrawError && <p className="error" style={{ fontSize: "0.7rem" }}>{withdrawError}</p>}
                        <p className="muted" style={{ fontSize: "0.65rem", marginBottom: "0.3rem" }}>
                          {isOwner
                            ? "All items in this package will be moved to main storage."
                            : "All items in this package will be moved to your ephemeral storage."}
                        </p>
                        <div className="alloc-actions">
                          <button
                            className="btn-subtle"
                            disabled={allocSaving || batchPending}
                            onClick={async () => {
                              try {
                                if (!character?.objectId || !character?.ownerCapId || !pkg) {
                                  setWithdrawError("Missing character data or package info.");
                                  return;
                                }
                                const batchItems = pkg.items
                                  .filter((it) => it.itemTypeId)
                                  .map((it) => ({ typeId: it.itemTypeId, quantity: it.quantity }));
                                if (isOwner) {
                                  const ok = await releaseBatch(
                                    character.objectId,
                                    character.ownerCapId,
                                    batchItems,
                                  );
                                  if (!ok) {
                                    setWithdrawError("On-chain batch release to main failed.");
                                    return;
                                  }
                                } else {
                                  const ok = await releaseEphBatch(
                                    character.objectId,
                                    character.ownerCapId,
                                    batchItems,
                                  );
                                  if (!ok) {
                                    setWithdrawError("On-chain batch transfer failed.");
                                    return;
                                  }
                                }
                                setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
                                await withdrawPackage(a.id);
                                // Mark package status back to created (no longer allocated)
                                await fetch(
                                  `/api/packages?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}&action=update-status`,
                                  {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ packageId: a.packageId, status: "withdrawn" }),
                                  },
                                );
                                queryClient.invalidateQueries({ queryKey: ["packages"] });
                                setWithdrawingAlloc(null);
                              } catch (err) {
                                setWithdrawError((err as Error).message);
                              }
                            }}
                          >
                            {(allocSaving || batchPending) ? "Processing…" : "Confirm Withdraw All"}
                          </button>
                          <button className="btn-subtle" onClick={() => setWithdrawingAlloc(null)}>Cancel</button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      )}

      {/* ── Packaging (tribe members) ── */}
      {isTribeMember && (
        <div style={{ marginTop: "1.5rem", borderTop: "1px solid var(--border, #333)", paddingTop: "1rem" }}>
          <PackagingTab isOwner={isOwner} />
        </div>
      )}
    </>
  );
}
