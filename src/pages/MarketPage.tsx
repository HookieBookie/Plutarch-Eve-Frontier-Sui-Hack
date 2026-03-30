import { useState, useMemo } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useQueryClient } from "@tanstack/react-query";
import { useCharacter } from "../hooks/useCharacter";
import { useItemCatalog, getCategories, type ItemType } from "../hooks/useItemCatalog";
import { useMarketOrders, calcFee, type OrderSide, type MarketOrder } from "../hooks/useMarketOrders";
import { useOffChainBalance } from "../hooks/useOffChainBalance";
import { useSsuInventory, findItemQuantity, type InventoryItem } from "../hooks/useSsuInventory";
import { TRIBE_ID, FEE_BPS } from "../config";
import { useTicker } from "../context/DeploymentContext";
import { useVaultData, useWalletCredits } from "../hooks/useVaultData";
import { useVaultId } from "../hooks/useVaultId";
import { useRedeem } from "../hooks/useVaultTransactions";
import { useTribeTax, calcTribeTax } from "../hooks/useTribeTax";
import {
  useTrade,
  resolveCharacterId,
  useEscrowFromEphemeral,
  useEscrowFromMain,
  useReleaseToEphemeral,
  useReleaseToMain,
  useDistribute,
} from "../hooks/useEphemeralTransfer";
import { Select } from "../components/Select";
import { isStructure, getStructureComponents, getTypeIdByName } from "../data/supplyChain";
import { usePackages, type Package } from "../hooks/usePackages";

interface Props {
  ssuId: string;
  ssuTribeId: string;
}

export function MarketPage({ ssuId, ssuTribeId }: Props) {
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const { data: character } = useCharacter(account?.address);
  const tribeId = String(character?.tribeId ?? TRIBE_ID);
  const isTribeMember = !!ssuTribeId && tribeId === ssuTribeId;
  const { data: earnedCredits } = useOffChainBalance(tribeId, account?.address);
  const { data: vaultId } = useVaultId(character?.tribeId);
  const { data: vault } = useVaultData(vaultId);
  const { data: walletCredits } = useWalletCredits(account?.address, vault, vaultId);
  const { redeem: redeemCredits, pending: redeemPending } = useRedeem(vaultId);
  const ticker = useTicker();

  const { data: catalog, isLoading: catalogLoading } = useItemCatalog();
  const { data: ssuInventory } = useSsuInventory(ssuId);
  const {
    sellOrders,
    buyOrders,
    history,
    placeOrder,
    cancelOrder,
    fillOrder,
    isLoading: marketLoading,
  } = useMarketOrders(ssuId, tribeId);
  const { packages, listOnMarket } = usePackages(ssuId, tribeId);

  // ── UI state ──
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [selectedItem, setSelectedItem] = useState<ItemType | null>(null);
  const [selectedPackage, setSelectedPackage] = useState<Package | null>(null);
  const [orderSide, setOrderSide] = useState<OrderSide>("buy");
  const [orderQty, setOrderQty] = useState("");
  const [orderPrice, setOrderPrice] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const [tab, setTab] = useState<"browse" | "my-orders">("browse");
  const [browseMode, setBrowseMode] = useState<"buy" | "sell">("buy");
  const [browserOpen, setBrowserOpen] = useState(false);
  const [orderError, setOrderError] = useState<string | null>(null);
  const [orderVisibility, setOrderVisibility] = useState<"tribal" | "public">("tribal");

  // ── Wallet-to-earned transfer confirmation ──
  const [transferPrompt, setTransferPrompt] = useState<{
    shortfall: number;
    totalCost: number;
    action: "place" | "fill";
    fillOrder?: MarketOrder;
    fillQuantity?: number;
  } | null>(null);

  // ── Fill-quantity prompt (for partial fills) ──
  const [fillPrompt, setFillPrompt] = useState<{ order: MarketOrder } | null>(null);
  const [fillQtyInput, setFillQtyInput] = useState("");

  const categories = useMemo(() => (catalog ? ["All", ...getCategories(catalog)] : ["All"]), [catalog]);

  // Determine the current user's sellable inventory:
  // - SSU owner sells from mainItems
  // - Non-owner sells from their ephemeral slot
  const myInventory: InventoryItem[] = useMemo(() => {
    if (!ssuInventory) return [];
    const ownerAddr = ssuInventory.ownerId?.toLowerCase() ?? "";
    const myAddr = account?.address?.toLowerCase() ?? "";
    if (ownerAddr && myAddr === ownerAddr) return ssuInventory.mainItems;
    const myCapId = character?.ownerCapId;
    if (myCapId) return ssuInventory.ephemeralByOwner.get(myCapId) ?? [];
    return ssuInventory.allEphemeral;
  }, [ssuInventory, account?.address, character?.ownerCapId]);

  const filteredItems = useMemo(() => {
    if (!catalog) return [];
    let items: ItemType[] = catalog;

    // In sell mode, only show items the current user actually has
    if (browseMode === "sell" && ssuInventory) {
      const haveItems = myInventory.filter((i) => i.quantity > 0);
      const inventoryTypeIds = new Set(haveItems.map((i) => i.type_id));
      const inventoryNames = new Set(haveItems.filter((i) => i.name).map((i) => i.name.toLowerCase()));

      // Keep catalog items that match inventory
      items = items.filter(
        (item) => inventoryTypeIds.has(item.id) || inventoryNames.has(item.name.toLowerCase()),
      );

      // Also add inventory items not found in the catalog
      const catalogIds = new Set(catalog.map((c) => c.id));
      const catalogNames = new Set(catalog.map((c) => c.name.toLowerCase()));
      for (const inv of haveItems) {
        if (catalogIds.has(inv.type_id) || (inv.name && catalogNames.has(inv.name.toLowerCase()))) continue;
        items.push({
          id: inv.type_id,
          name: inv.name || `Type #${inv.type_id}`,
          description: "",
          mass: 0,
          volume: 0,
          portionSize: 1,
          groupName: "Other",
          groupId: 0,
          categoryName: "Other",
          categoryId: 0,
          radius: 0,
          iconUrl: `/icons/${inv.type_id}.png`,
        });
      }
    }

    return items.filter((item) => {
      if (selectedCategory !== "All" && item.categoryName !== selectedCategory) return false;
      if (searchTerm && !item.name.toLowerCase().includes(searchTerm.toLowerCase())) return false;
      return true;
    });
  }, [catalog, selectedCategory, searchTerm, browseMode, ssuInventory]);

  // Orders for the currently selected item
  const itemSells = useMemo(
    () => (selectedItem ? sellOrders.filter((o) => o.itemTypeId === selectedItem.id) : sellOrders),
    [sellOrders, selectedItem],
  );
  const itemBuys = useMemo(
    () => (selectedItem ? buyOrders.filter((o) => o.itemTypeId === selectedItem.id) : buyOrders),
    [buyOrders, selectedItem],
  );
  const itemHistory = useMemo(
    () =>
      (selectedItem ? history.filter((h) => h.itemTypeId === selectedItem.id) : history)
        .sort((a, b) => new Date(b.completedAt).getTime() - new Date(a.completedAt).getTime())
        .slice(0, 50),
    [history, selectedItem],
  );

  // My open orders
  const myOrders = useMemo(
    () => (account ? sellOrders.concat(buyOrders).filter((o) => o.wallet === account.address) : []),
    [sellOrders, buyOrders, account],
  );

  const feePct = FEE_BPS / 100;
  const { taxBps, taxPct } = useTribeTax(tribeId);

  // SSU ownership flag
  const isOwner = useMemo(() => {
    if (!ssuInventory || !account) return false;
    return (ssuInventory.ownerId?.toLowerCase() ?? "") === account.address.toLowerCase();
  }, [ssuInventory, account]);

  // On-chain item transfer hooks
  const { trade: onChainTrade } = useTrade(ssuId || undefined);
  const { distribute: onChainDistribute } = useDistribute(ssuId || undefined);
  const { escrow: escrowFromEphemeral } = useEscrowFromEphemeral(ssuId || undefined);
  const { escrow: escrowFromMain } = useEscrowFromMain(ssuId || undefined);
  const { release: releaseToEphemeral } = useReleaseToEphemeral(ssuId || undefined);
  const { release: releaseToMain } = useReleaseToMain(ssuId || undefined);

  // ── Order placement ──
  const qty = Number(orderQty);
  const price = Number(orderPrice);
  const orderTotal = qty * price;
  const orderFee = calcFee(qty, price);
  const orderTax = calcTribeTax(orderTotal, taxBps);
  const canPlace = !!selectedItem && qty > 0 && price > 0 && !!account && !placeOrder.isPending;

  // Balance / inventory warnings
  const buyTotal = orderTotal + orderFee + orderTax;
  const displayEarned = earnedCredits ?? 0;
  const displayWallet = walletCredits ? walletCredits.credits / 1e9 : 0;
  const balance = displayEarned + displayWallet;
  const insufficientBuy = orderSide === "buy" && qty > 0 && price > 0 && buyTotal > balance;
  const needsWalletTransfer = orderSide === "buy" && qty > 0 && price > 0 && buyTotal > displayEarned && buyTotal <= balance;

  // For sell orders: check user has enough items in their inventory
  const sellableQty = useMemo(() => {
    if (!selectedItem || !ssuInventory) return 0;
    return findItemQuantity(myInventory, selectedItem.id, selectedItem.name);
  }, [selectedItem, ssuInventory, myInventory]);
  const insufficientItems = orderSide === "sell" && qty > 0 && qty > sellableQty;

  // Structure trade: resolve components when selected item is a structure
  const structureComps = useMemo(() => {
    if (!selectedItem) return null;
    if (!isStructure(selectedItem.name)) return null;
    return getStructureComponents(selectedItem.name).map((c) => ({
      ...c,
      typeId: getTypeIdByName(c.component),
    }));
  }, [selectedItem]);

  /** Execute order placement, optionally topping up from wallet credits. */
  function executePlaceOrder(walletTopUp = 0) {
    if (!selectedItem || !account || !character) return;

    (async () => {
      try {
        // On-chain: escrow items into open storage when placing a sell order
        if (orderSide === "sell" && character.objectId && character.ownerCapId && selectedItem.id) {
          try {
            const escrowFn = isOwner ? escrowFromMain : escrowFromEphemeral;
            if (structureComps) {
              // Structure trade: escrow each component separately
              for (const comp of structureComps) {
                if (comp.typeId) {
                  await escrowFn(character.objectId, character.ownerCapId, comp.typeId, comp.qty * qty);
                }
              }
              queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] });
            } else {
              const ok = await escrowFn(character.objectId, character.ownerCapId, selectedItem.id, qty);
              if (ok) queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] });
              else console.warn("[market] On-chain escrow failed. Proceeding off-chain.");
            }
          } catch (e) {
            console.warn("[market] On-chain escrow error, proceeding off-chain:", e);
          }
        }

        placeOrder.mutate(
          {
            side: orderSide,
            wallet: account.address,
            playerName: character.name ?? "Unknown",
            itemTypeId: selectedItem.id,
            itemName: selectedItem.name,
            quantity: qty,
            pricePerUnit: price,
            taxBps,
            walletCredits: displayWallet,
            walletTopUp: walletTopUp > 0 ? walletTopUp : undefined,
            visibility: isTribeMember ? orderVisibility : "public",
          },
          {
            onSuccess: () => {
              setOrderQty("");
              setOrderPrice("");
              setOrderError(null);
            },
            onError: (err) => {
              setOrderError((err as Error).message || "Failed to place order");
            },
          },
        );
      } catch (err) {
        setOrderError((err as Error).message || "Failed to place sell order");
      }
    })();
  }

  function handlePlaceOrder() {
    if (!selectedItem || !account || !character) return;
    setOrderError(null);

    if (orderSide === "buy" && insufficientBuy) {
      setOrderError(`Insufficient credits. Need ${buyTotal.toLocaleString()} but you only have ${balance.toLocaleString()} total.`);
      return;
    }
    if (orderSide === "buy" && needsWalletTransfer) {
      const shortfall = Math.ceil(buyTotal - displayEarned);
      setTransferPrompt({ shortfall, totalCost: buyTotal, action: "place" });
      return;
    }
    if (orderSide === "sell" && insufficientItems) {
      setOrderError(`Insufficient items. You have ${sellableQty.toLocaleString()} in storage but need ${qty.toLocaleString()}.`);
      return;
    }

    executePlaceOrder();
  }

  function handleCancel(orderId: string) {
    if (!account) return;
    setOrderError(null);

    // For sell orders, release escrowed items from open storage before off-chain cancel
    const order = myOrders.find((o) => o.id === orderId);
    if (order && order.side === "sell" && character?.objectId && character?.ownerCapId) {
      const cancelStructComps = isStructure(order.itemName)
        ? getStructureComponents(order.itemName).map((c) => ({ ...c, typeId: getTypeIdByName(c.component) }))
        : null;

      (async () => {
        try {
          const releaseFn = isOwner ? releaseToMain : releaseToEphemeral;
          if (order.packageItems && order.packageItems.length > 0) {
            // Package order: release each package item
            for (const item of order.packageItems) {
              if (item.itemTypeId) {
                await releaseFn(character.objectId, character.ownerCapId, item.itemTypeId, item.quantity);
              }
            }
          } else if (cancelStructComps) {
            for (const comp of cancelStructComps) {
              if (comp.typeId) {
                await releaseFn(character.objectId, character.ownerCapId, comp.typeId, comp.qty * order.quantity);
              }
            }
          } else {
            await releaseFn(character.objectId, character.ownerCapId, order.itemTypeId, order.quantity);
          }
          queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] });
        } catch (e) {
          console.warn("[market] On-chain release error:", e);
        }
        cancelOrder.mutate(
          { orderId, wallet: account.address },
          { onError: (err) => setOrderError((err as Error).message || "Failed to cancel order") },
        );
      })();
    } else {
      cancelOrder.mutate(
        { orderId, wallet: account.address },
        { onError: (err) => setOrderError((err as Error).message || "Failed to cancel order") },
      );
    }
  }

  /** Execute fill order, optionally topping up from wallet credits. */
  function executeFillOrder(order: MarketOrder, walletTopUp = 0, fillQuantity?: number) {
    if (!account || !character) return;
    const qty = fillQuantity ?? order.quantity;

    // Resolve structure components for this order's item
    const orderStructComps = isStructure(order.itemName)
      ? getStructureComponents(order.itemName).map((c) => ({ ...c, typeId: getTypeIdByName(c.component) }))
      : null;

    (async () => {
      try {
        if (order.side === "sell" && character.objectId && character.ownerCapId && (order.itemTypeId || order.packageItems)) {
          try {
            const buyerReleaseFn = isOwner ? releaseToMain : releaseToEphemeral;
            if (order.packageItems && order.packageItems.length > 0) {
              // Package order: release each package item to buyer
              for (const item of order.packageItems) {
                if (item.itemTypeId) {
                  await buyerReleaseFn(character.objectId, character.ownerCapId, item.itemTypeId, item.quantity * qty);
                }
              }
              queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] });
            } else if (orderStructComps) {
              // Structure trade: release each component to buyer
              for (const comp of orderStructComps) {
                if (comp.typeId) {
                  await buyerReleaseFn(character.objectId, character.ownerCapId, comp.typeId, comp.qty * qty);
                }
              }
              queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] });
            } else {
              await buyerReleaseFn(character.objectId, character.ownerCapId, order.itemTypeId, qty);
              queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] });
            }
          } catch (e) {
            console.warn("[market] On-chain release to buyer error, proceeding off-chain:", e);
          }
        }

        if (order.side === "buy" && character.objectId && character.ownerCapId && order.itemTypeId) {
          try {
            const buyerCharId = await resolveCharacterId(order.wallet);
            if (buyerCharId) {
              if (isOwner && ssuInventory?.ownerCapId) {
                // SSU owner: items are in main storage → use distribute
                if (orderStructComps) {
                  for (const comp of orderStructComps) {
                    if (comp.typeId) {
                      await onChainDistribute(ssuInventory.ownerCapId, character.objectId, buyerCharId, comp.typeId, comp.qty * qty);
                    }
                  }
                } else {
                  await onChainDistribute(ssuInventory.ownerCapId, character.objectId, buyerCharId, order.itemTypeId, qty);
                }
                queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] });
              } else {
                // Non-owner: items are in ephemeral → use trade
                if (orderStructComps) {
                  for (const comp of orderStructComps) {
                    if (comp.typeId) {
                      await onChainTrade(character.objectId, character.ownerCapId, buyerCharId, comp.typeId, comp.qty * qty);
                    }
                  }
                } else {
                  const ok = await onChainTrade(character.objectId, character.ownerCapId, buyerCharId, order.itemTypeId, qty);
                  if (!ok) console.warn("[market] On-chain trade failed. Proceeding off-chain.");
                }
                queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] });
              }
            }
          } catch (e) {
            console.warn("[market] On-chain trade error, proceeding off-chain:", e);
          }
        }

        fillOrder.mutate(
          {
            orderId: order.id,
            fillerWallet: account.address,
            fillerName: character.name ?? "Unknown",
            fillQuantity: qty,
            taxBps,
            walletCredits: displayWallet,
            walletTopUp: walletTopUp > 0 ? walletTopUp : undefined,
          },
          { onError: (err) => setOrderError((err as Error).message || "Failed to fill order") },
        );
      } catch (err) {
        setOrderError((err as Error).message || "Trade failed");
      }
    })();
  }

  function handleFill(order: MarketOrder) {
    if (!account || !character) return;
    setOrderError(null);

    // For sell orders, open the quantity prompt so the buyer can choose a partial fill
    if (order.side === "sell") {
      setFillPrompt({ order });
      setFillQtyInput(String(order.quantity));
      return;
    }

    // Selling into a buy order: check seller has items in ephemeral
    if (order.side === "buy" && ssuInventory) {
      const available = findItemQuantity(myInventory, order.itemTypeId, order.itemName);
      if (available < order.quantity) {
        setOrderError(`Insufficient items. You have ${available.toLocaleString()} in storage but need ${order.quantity.toLocaleString()}.`);
        return;
      }
    }

    executeFillOrder(order);
  }

  function abbreviate(addr: string) {
    return addr.length > 12 ? addr.slice(0, 6) + "…" + addr.slice(-4) : addr;
  }

  function formatTime(iso: string) {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }

  if (catalogLoading || marketLoading) {
    return <div className="page-single"><p className="muted">Loading marketplace…</p></div>;
  }

  return (
    <div className="market-layout">
      {/* ═══ Floating Item Browser ═══ */}
      {browserOpen && (
        <div className="market-browser-backdrop" onClick={() => setBrowserOpen(false)}>
          <aside className="market-browser-panel panel" onClick={(e) => e.stopPropagation()}>
            <div className="market-browser-header">
              <h3>Item Browser</h3>
              <button className="market-browser-close" onClick={() => setBrowserOpen(false)}>✕</button>
            </div>

            <div className="order-side-toggle" style={{ marginBottom: "0.5rem" }}>
              <button
                className={`side-btn ${browseMode === "buy" ? "active buy" : ""}`}
                onClick={() => { setBrowseMode("buy"); setOrderSide("buy"); }}
              >
                Buy
              </button>
              <button
                className={`side-btn ${browseMode === "sell" ? "active sell" : ""}`}
                onClick={() => { setBrowseMode("sell"); setOrderSide("sell"); }}
              >
                Sell
              </button>
            </div>

            <input
              type="text"
              className="market-search"
              placeholder="Search items…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              autoFocus
            />
            <Select
              className="market-category-select"
              value={selectedCategory}
              onChange={setSelectedCategory}
              options={categories.map((c) => ({ value: c, label: c }))}
            />

            <div className="market-item-list">
              {filteredItems.length === 0 && (
                <p className="muted">
                  {browseMode === "sell" ? "No items in SSU storage" : "No items found"}
                </p>
              )}
              {filteredItems.slice(0, 150).map((item) => (
                <button
                  key={item.id}
                  className={`market-item-row ${selectedItem?.id === item.id && !selectedPackage ? "active" : ""}`}
                  onClick={() => { setSelectedItem(item); setSelectedPackage(null); setBrowserOpen(false); }}
                >
                  {item.iconUrl && <img src={item.iconUrl} alt="" className="market-item-icon" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />}
                  <div className="market-item-info">
                    <span className="market-item-name">{item.name}</span>
                    <span className="market-item-cat">{item.categoryName}</span>
                  </div>
                  {browseMode === "sell" && ssuInventory ? (() => {
                    const inv = myInventory.find(
                      (i) => i.type_id === item.id || (i.name && i.name.toLowerCase() === item.name.toLowerCase()),
                    );
                    return inv ? <span className="market-inv-qty">{inv.quantity.toLocaleString()}</span> : null;
                  })() : (() => {
                    const count = sellOrders.filter((o) => o.itemTypeId === item.id).length +
                      buyOrders.filter((o) => o.itemTypeId === item.id).length;
                    return count > 0 ? <span className="market-order-count">{count}</span> : null;
                  })()}
                </button>
              ))}

              {/* ── Packages section (sell mode only) ── */}
              {browseMode === "sell" && (() => {
                const sellablePackages = packages.filter(
                  (p) => p.status === "created" && (!searchTerm || p.name.toLowerCase().includes(searchTerm.toLowerCase())),
                );
                if (sellablePackages.length === 0) return null;
                return (
                  <>
                    <div style={{ padding: "0.5rem 0.75rem", fontSize: "0.7rem", fontWeight: 600, color: "var(--text-muted, #888)", borderTop: "1px solid var(--border, #333)", marginTop: "0.25rem" }}>
                      Packages
                    </div>
                    {sellablePackages.map((pkg) => (
                      <button
                        key={pkg.id}
                        className={`market-item-row ${selectedPackage?.id === pkg.id ? "active" : ""}`}
                        onClick={() => {
                          setSelectedPackage(pkg);
                          setSelectedItem({
                            id: 0,
                            name: `📦 ${pkg.name}`,
                            description: pkg.shipType ? `Ship fitting: ${pkg.shipType}` : "Custom bundle",
                            mass: 0, volume: 0, portionSize: 1,
                            groupName: "Package", groupId: 0,
                            categoryName: "Package", categoryId: 0,
                            radius: 0, iconUrl: "",
                          });
                          setOrderSide("sell");
                          setOrderQty("1");
                          setBrowserOpen(false);
                        }}
                      >
                        <span style={{ fontSize: "1.1rem", marginRight: "0.3rem" }}>📦</span>
                        <div className="market-item-info">
                          <span className="market-item-name">{pkg.name}</span>
                          <span className="market-item-cat">
                            {pkg.shipType || "Bundle"} · {pkg.items.length} item{pkg.items.length !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </button>
                    ))}
                  </>
                );
              })()}
            </div>
          </aside>
        </div>
      )}

      {/* ═══ LEFT: Order Book ═══ */}
      <section className="market-book panel">
        <div className="panel-header-row">
          <h3>
            {selectedItem ? (
              <button className="market-item-link" onClick={() => setBrowserOpen(true)}>
                {selectedItem.name} ▾
              </button>
            ) : (
              <button className="market-item-link" onClick={() => setBrowserOpen(true)}>
                Select Item ▾
              </button>
            )}
          </h3>
          <div className="market-book-tabs">
            <button className={`market-tab ${!showHistory ? "active" : ""}`} onClick={() => setShowHistory(false)}>
              Order Book
            </button>
            <button className={`market-tab ${showHistory ? "active" : ""}`} onClick={() => setShowHistory(true)}>
              History
            </button>
          </div>
        </div>

        {selectedItem && (
          <div className="market-item-detail">
            {selectedItem.iconUrl && (
              <img src={selectedItem.iconUrl} alt="" className="market-detail-icon" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
            )}
            <span className="market-detail-label">Category</span>
            <span>{selectedItem.categoryName}</span>
            <span className="market-detail-label">Group</span>
            <span>{selectedItem.groupName}</span>
            <span className="market-detail-label">Volume</span>
            <span>{selectedItem.volume} m³</span>
            <span className="market-detail-label">Type ID</span>
            <span>{selectedItem.id}</span>
            {structureComps && (
              <>
                <span className="market-detail-label" style={{ gridColumn: "1 / -1", marginTop: "0.5rem", fontWeight: 600 }}>
                  Structure Components (per unit)
                </span>
                {structureComps.map((c) => (
                  <span key={c.component} style={{ gridColumn: "1 / -1", fontSize: "0.8rem" }}>
                    {c.qty}× {c.component}
                  </span>
                ))}
              </>
            )}
          </div>
        )}

        {orderError && (
          <p className="error" style={{ margin: "0.5rem 0" }}>{orderError}</p>
        )}

        {!showHistory ? (
          <>
            {/* Sell Orders (asks) – lowest first */}
            <div className="order-book-section">
              <div className="order-book-header sell-header">
                <span>Sell Orders</span>
                <span>{itemSells.length}</span>
              </div>
              <div className="order-book-columns">
                <span>Player</span><span>Qty</span><span>Price/u</span><span>Total</span><span></span>
              </div>
              {itemSells.length === 0 && <p className="muted order-empty">No sell orders</p>}
              {itemSells.map((o) => (
                <div key={o.id} className="order-row sell-row" title={o.packageItems?.length ? o.packageItems.map(i => `${i.quantity}× ${i.itemName}`).join('\n') : undefined}>
                  <span className="order-player" title={o.wallet}>
                    {o.visibility === "public" && <span title="Public" style={{ fontSize: "0.6rem", marginRight: "0.2rem" }}>🌐</span>}
                    {o.packageItems?.length ? "📦 " : ""}{o.playerName || abbreviate(o.wallet)}
                  </span>
                  <span className="order-qty">{o.quantity.toLocaleString()}</span>
                  <span className="order-price">{o.pricePerUnit.toLocaleString()}</span>
                  <span className="order-total">{(o.quantity * o.pricePerUnit).toLocaleString()}</span>
                  <span className="order-actions">
                    {account && o.wallet !== account.address && (
                      <button className="btn-fill" onClick={() => handleFill(o)} disabled={fillOrder.isPending}>
                        Buy
                      </button>
                    )}
                    {account && o.wallet === account.address && (
                      <button className="btn-cancel" onClick={() => handleCancel(o.id)} disabled={cancelOrder.isPending}>
                        ✕
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>

            {/* Spread Indicator */}
            {itemSells.length > 0 && itemBuys.length > 0 && (
              <div className="order-spread">
                Spread: {(itemSells[0].pricePerUnit - itemBuys[0].pricePerUnit).toLocaleString()} {ticker}
              </div>
            )}

            {/* Buy Orders (bids) – highest first */}
            <div className="order-book-section">
              <div className="order-book-header buy-header">
                <span>Buy Orders</span>
                <span>{itemBuys.length}</span>
              </div>
              <div className="order-book-columns">
                <span>Player</span><span>Qty</span><span>Price/u</span><span>Total</span><span></span>
              </div>
              {itemBuys.length === 0 && <p className="muted order-empty">No buy orders</p>}
              {itemBuys.map((o) => (
                <div key={o.id} className="order-row buy-row">
                  <span className="order-player" title={o.wallet}>
                    {o.visibility === "public" && <span title="Public" style={{ fontSize: "0.6rem", marginRight: "0.2rem" }}>🌐</span>}
                    {o.playerName || abbreviate(o.wallet)}</span>
                  <span className="order-qty">{o.quantity.toLocaleString()}</span>
                  <span className="order-price">{o.pricePerUnit.toLocaleString()}</span>
                  <span className="order-total">{(o.quantity * o.pricePerUnit).toLocaleString()}</span>
                  <span className="order-actions">
                    {account && o.wallet !== account.address && (
                      <button className="btn-fill" onClick={() => handleFill(o)} disabled={fillOrder.isPending}>
                        Sell
                      </button>
                    )}
                    {account && o.wallet === account.address && (
                      <button className="btn-cancel" onClick={() => handleCancel(o.id)} disabled={cancelOrder.isPending}>
                        ✕
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </>
        ) : (
          /* ── Trade History ── */
          <div className="order-book-section">
            <div className="order-book-columns">
              <span>Time</span><span>Item</span><span>Qty</span><span>Price/u</span><span>Total</span>
            </div>
            {itemHistory.length === 0 && <p className="muted order-empty">No trades yet</p>}
            {itemHistory.map((h) => (
              <div key={h.id} className={`order-row ${h.side === "sell" ? "sell-row" : "buy-row"}`}>
                <span className="order-time">{formatTime(h.completedAt)}</span>
                <span className="order-item-name">{h.itemName}</span>
                <span className="order-qty">{h.quantity.toLocaleString()}</span>
                <span className="order-price">{h.pricePerUnit.toLocaleString()}</span>
                <span className="order-total">{(h.quantity * h.pricePerUnit).toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ═══ RIGHT: Place Order + My Orders ═══ */}
      <aside className="market-actions panel">
        <div className="market-actions-tabs">
          <button className={`market-tab ${tab === "browse" ? "active" : ""}`} onClick={() => setTab("browse")}>
            Place Order
          </button>
          <button className={`market-tab ${tab === "my-orders" ? "active" : ""}`} onClick={() => setTab("my-orders")}>
            My Orders ({myOrders.length})
          </button>
        </div>

        {tab === "browse" && (
          <div className="place-order-form">
            {!selectedItem ? (
              <p className="muted" style={{ padding: "1rem 0", cursor: "pointer" }} onClick={() => setBrowserOpen(true)}>
                Select an item from the browser to place an order
              </p>
            ) : selectedPackage ? (
              /* ── Package sell form ── */
              <>
                <div className="order-item-header">
                  <span className="order-item-title">📦 {selectedPackage.name}</span>
                  <span className="order-item-category">
                    {selectedPackage.shipType || "Bundle"} · {selectedPackage.items.length} item{selectedPackage.items.length !== 1 ? "s" : ""}
                  </span>
                </div>

                <div style={{ fontSize: "0.75rem", color: "#888", marginBottom: "0.5rem", paddingLeft: "0.5rem", borderLeft: "2px solid #444" }}>
                  {selectedPackage.items.map((item, i) => (
                    <div key={i}>{item.quantity}× {item.itemName}</div>
                  ))}
                </div>

                <div className="order-field">
                  <label>Total Price <span className="muted">({ticker})</span></label>
                  <input
                    type="number"
                    min="1"
                    placeholder={`${ticker} total`}
                    value={orderPrice}
                    onChange={(e) => setOrderPrice(e.target.value)}
                  />
                </div>

                <button
                  className="btn-primary btn-place-order"
                  disabled={!price || price <= 0 || !account || !character}
                  onClick={async () => {
                    setOrderError(null);
                    try {
                      await listOnMarket({
                        packageId: selectedPackage.id,
                        wallet: account!.address,
                        playerName: character!.name ?? "Unknown",
                        price,
                      });
                      setSelectedPackage(null);
                      setSelectedItem(null);
                      setOrderPrice("");
                    } catch (err) {
                      setOrderError((err as Error).message);
                    }
                  }}
                >
                  List Package
                </button>

                {orderError && <p className="error">{orderError}</p>}
              </>
            ) : (
              <>
                <div className="order-item-header">
                  <span className="order-item-title">{selectedItem.name}</span>
                  <span className="order-item-category">{selectedItem.categoryName}</span>
                </div>

                <div className="order-side-toggle">
                  <button
                    className={`side-btn ${orderSide === "sell" ? "active sell" : ""}`}
                    onClick={() => { setOrderSide("sell"); setBrowseMode("sell"); setBrowserOpen(true); }}
                  >
                    Sell
                  </button>
                  <button
                    className={`side-btn ${orderSide === "buy" ? "active buy" : ""}`}
                    onClick={() => { setOrderSide("buy"); setBrowseMode("buy"); setBrowserOpen(true); }}
                  >
                    Buy
                  </button>
                </div>

                <div className="order-field">
                  <label>Quantity</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Amount"
                    value={orderQty}
                    onChange={(e) => setOrderQty(e.target.value)}
                  />
                </div>

                <div className="order-field">
                  <label>Price per unit <span className="muted">({ticker})</span></label>
                  <input
                    type="number"
                    min="1"
                    placeholder={`${ticker} per item`}
                    value={orderPrice}
                    onChange={(e) => setOrderPrice(e.target.value)}
                  />
                </div>

                {/* Visibility toggle — tribe members can choose, non-tribe forced public */}
                <div className="order-field">
                  <label>Visibility</label>
                  {isTribeMember ? (
                    <div className="order-side-toggle" style={{ marginBottom: 0 }}>
                      <button
                        className={`side-btn ${orderVisibility === "tribal" ? "active" : ""}`}
                        onClick={() => setOrderVisibility("tribal")}
                        style={{ fontSize: "0.75rem" }}
                      >
                        Tribal
                      </button>
                      <button
                        className={`side-btn ${orderVisibility === "public" ? "active" : ""}`}
                        onClick={() => setOrderVisibility("public")}
                        style={{ fontSize: "0.75rem" }}
                      >
                        Public
                      </button>
                    </div>
                  ) : (
                    <span className="muted" style={{ fontSize: "0.8rem" }}>Public (non-tribe orders are always public)</span>
                  )}
                </div>

                {qty > 0 && price > 0 && (
                  <div className="order-summary">
                    <div className="order-summary-row">
                      <span>Subtotal</span>
                      <span>{orderTotal.toLocaleString()} cr</span>
                    </div>
                    <div className="order-summary-row">
                      <span>Protocol Fee ({feePct}%)</span>
                      <span>{orderFee.toLocaleString()} cr</span>
                    </div>
                    {orderTax > 0 && (
                      <div className="order-summary-row">
                        <span>Tribe Tax ({taxPct}%)</span>
                        <span>{orderTax.toLocaleString()} cr</span>
                      </div>
                    )}
                    <div className="order-summary-row total">
                      <span>Total</span>
                      <span>{(orderTotal + orderFee + orderTax).toLocaleString()} cr</span>
                    </div>
                  </div>
                )}

                {balance > 0 && (
                  <div className="order-balance">
                    Your balance: <strong>{balance.toLocaleString()}</strong> {ticker}
                    {displayEarned > 0 && displayWallet > 0 && (
                      <span className="muted" style={{ fontSize: "0.7rem" }}>
                        {" "}({displayEarned.toLocaleString()} earned + {displayWallet.toLocaleString()} wallet)
                      </span>
                    )}
                  </div>
                )}

                {orderSide === "sell" && selectedItem && (
                  <div className="order-balance">
                    In storage: <strong>{sellableQty.toLocaleString()}</strong> {selectedItem.name}
                  </div>
                )}

                {insufficientBuy && (
                  <p className="error">Insufficient {ticker} — need {buyTotal.toLocaleString()} cr</p>
                )}
                {needsWalletTransfer && (
                  <p className="warning" style={{ color: "#e0a800", fontSize: "0.82rem" }}>
                    Requires redeeming {Math.ceil(buyTotal - displayEarned).toLocaleString()} on-chain {ticker} (gas fee applies)
                  </p>
                )}
                {insufficientItems && (
                  <p className="error">Insufficient items — have {sellableQty.toLocaleString()}, need {qty.toLocaleString()}</p>
                )}

                <button
                  className="btn-primary btn-place-order"
                  disabled={!canPlace || insufficientBuy || insufficientItems}
                  onClick={handlePlaceOrder}
                >
                  {placeOrder.isPending
                    ? "Placing…"
                    : `Place ${orderSide === "sell" ? "Sell" : "Buy"} Order`}
                </button>

                {orderError && (
                  <p className="error">{orderError}</p>
                )}
                {placeOrder.isSuccess && !orderError && (
                  <p className="success">Order placed successfully</p>
                )}
              </>
            )}
          </div>
        )}

        {tab === "my-orders" && (
          <div className="my-orders-list">
            {!account && <p className="muted">Connect wallet to view orders</p>}
            {account && myOrders.length === 0 && <p className="muted">No open orders</p>}
            {myOrders.map((o) => (
              <div key={o.id} className={`my-order-card ${o.side}`}>
                <div className="my-order-header">
                  <span className={`order-side-badge ${o.side}`}>{o.side.toUpperCase()}</span>
                  <span className="my-order-item">{o.itemName}</span>
                  {o.visibility === "public" && <span title="Public order" style={{ fontSize: "0.65rem" }}>🌐</span>}
                </div>
                <div className="my-order-details">
                  <span>{o.quantity.toLocaleString()} × {o.pricePerUnit.toLocaleString()} cr</span>
                  <span className="order-total-small">
                    = {(o.quantity * o.pricePerUnit).toLocaleString()} cr
                  </span>
                </div>
                {o.packageItems && o.packageItems.length > 0 && (
                  <div className="my-order-package-items" style={{ fontSize: "0.75rem", color: "#888", marginTop: "0.25rem", paddingLeft: "0.5rem", borderLeft: "2px solid #444" }}>
                    {o.packageItems.map((item, i) => (
                      <div key={i}>{item.quantity}× {item.itemName}</div>
                    ))}
                  </div>
                )}
                <div className="my-order-footer">
                  <span className="order-time">{formatTime(o.createdAt)}</span>
                  <button
                    className="btn-cancel"
                    onClick={() => handleCancel(o.id)}
                    disabled={cancelOrder.isPending}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </aside>

      {/* ═══ Fill Quantity Selection Modal ═══ */}
      {fillPrompt && (() => {
        const o = fillPrompt.order;
        const fq = Number(fillQtyInput) || 0;
        const fqValid = fq > 0 && fq <= o.quantity;
        const fSubtotal = fq * o.pricePerUnit;
        const fFee = calcFee(fq, o.pricePerUnit);
        const fTax = calcTribeTax(fSubtotal, taxBps);
        const fTotal = fSubtotal + fFee + fTax;
        const fInsufficient = fqValid && fTotal > balance;
        const fNeedsTransfer = fqValid && fTotal > displayEarned && fTotal <= balance;
        return (
          <div className="market-browser-backdrop" onClick={() => setFillPrompt(null)}>
            <div className="panel" style={{ maxWidth: 420, margin: "10vh auto", padding: "1.5rem" }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ marginBottom: "0.75rem" }}>Buy {o.itemName}</h3>
              <p style={{ fontSize: "0.82rem", lineHeight: 1.5, marginBottom: "0.5rem" }}>
                <strong>{o.playerName}</strong> is selling <strong>{o.quantity.toLocaleString()}</strong> at <strong>{o.pricePerUnit.toLocaleString()}</strong> {ticker}/unit.
              </p>
              <div className="order-field" style={{ marginBottom: "0.75rem" }}>
                <label>Quantity to buy (max {o.quantity.toLocaleString()})</label>
                <input
                  type="number"
                  min="1"
                  max={o.quantity}
                  value={fillQtyInput}
                  onChange={(e) => setFillQtyInput(e.target.value)}
                  autoFocus
                />
              </div>
              {fqValid && (
                <div className="order-summary" style={{ marginBottom: "0.75rem" }}>
                  <div className="order-summary-row">
                    <span>Subtotal ({fq} × {o.pricePerUnit.toLocaleString()})</span>
                    <span>{fSubtotal.toLocaleString()} cr</span>
                  </div>
                  <div className="order-summary-row">
                    <span>Fee ({FEE_BPS / 100}%)</span>
                    <span>{fFee.toLocaleString()} cr</span>
                  </div>
                  {fTax > 0 && (
                    <div className="order-summary-row">
                      <span>Tribe Tax ({taxPct}%)</span>
                      <span>{fTax.toLocaleString()} cr</span>
                    </div>
                  )}
                  <div className="order-summary-row total">
                    <span>Total</span>
                    <span>{fTotal.toLocaleString()} cr</span>
                  </div>
                </div>
              )}
              {fInsufficient && (
                <p className="error" style={{ fontSize: "0.82rem" }}>
                  Insufficient credits. Need {fTotal.toLocaleString()} but you have {balance.toLocaleString()}.
                </p>
              )}
              {fNeedsTransfer && (
                <p className="warning" style={{ color: "#e0a800", fontSize: "0.82rem" }}>
                  Requires redeeming {Math.ceil(fTotal - displayEarned).toLocaleString()} on-chain {ticker} (gas fee applies)
                </p>
              )}
              <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
                <button className="btn-cancel" onClick={() => setFillPrompt(null)}>Cancel</button>
                <button
                  className="btn-primary"
                  disabled={!fqValid || fInsufficient || fillOrder.isPending}
                  onClick={() => {
                    const order = fillPrompt.order;
                    const buyQty = Number(fillQtyInput);
                    setFillPrompt(null);

                    // Check if wallet transfer is needed
                    const cost = buyQty * order.pricePerUnit + calcFee(buyQty, order.pricePerUnit) + calcTribeTax(buyQty * order.pricePerUnit, taxBps);
                    if (displayEarned < cost && balance >= cost) {
                      const shortfall = Math.ceil(cost - displayEarned);
                      setTransferPrompt({ shortfall, totalCost: cost, action: "fill", fillOrder: order, fillQuantity: buyQty });
                      return;
                    }

                    executeFillOrder(order, 0, buyQty);
                  }}
                >
                  {fillOrder.isPending ? "Processing…" : fq < o.quantity ? `Buy ${fq.toLocaleString()}` : "Buy All"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ Wallet Transfer Confirmation Modal ═══ */}
      {transferPrompt && (
        <div className="market-browser-backdrop" onClick={() => setTransferPrompt(null)}>
          <div className="panel" style={{ maxWidth: 420, margin: "10vh auto", padding: "1.5rem" }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginBottom: "0.75rem" }}>Transfer Wallet {ticker}</h3>
            <p style={{ fontSize: "0.82rem", lineHeight: 1.5, marginBottom: "0.5rem" }}>
              You need <strong>{transferPrompt.totalCost.toLocaleString()}</strong> {ticker} but only have{" "}
              <strong>{displayEarned.toLocaleString()}</strong> earned {ticker}.
            </p>
            <p style={{ fontSize: "0.82rem", lineHeight: 1.5, marginBottom: "0.75rem" }}>
              Redeem <strong>{transferPrompt.shortfall.toLocaleString()}</strong> {ticker} from your on-chain wallet
              to cover the difference? The {ticker} will be burned and you'll receive EVE in return.
            </p>
            <p className="muted" style={{ fontSize: "0.7rem", marginBottom: "1rem" }}>
              This requires an on-chain transaction (gas fee applies).
            </p>
            <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end" }}>
              <button className="btn-cancel" onClick={() => setTransferPrompt(null)}>
                Cancel
              </button>
              <button
                className="btn-primary"
                disabled={redeemPending}
                onClick={async () => {
                  const { shortfall, action, fillOrder: fillTarget } = transferPrompt;
                  // Execute on-chain redeem to actually burn credits from the wallet
                  const ok = await redeemCredits(shortfall);
                  if (!ok) {
                    setTransferPrompt(null);
                    setOrderError(`Failed to transfer ${ticker} from wallet. Transaction was rejected or failed.`);
                    return;
                  }
                  // Refresh wallet balance after on-chain burn
                  queryClient.invalidateQueries({ queryKey: ["plutarch-wallet-credits"] });
                  setTransferPrompt(null);
                  if (action === "place") {
                    executePlaceOrder(shortfall);
                  } else if (action === "fill" && fillTarget) {
                    executeFillOrder(fillTarget, shortfall, transferPrompt.fillQuantity);
                  }
                }}
              >
                {redeemPending ? "Processing…" : "Transfer & Continue"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
