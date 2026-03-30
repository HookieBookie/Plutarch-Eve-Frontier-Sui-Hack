import { useState, useEffect, useRef, useMemo } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { abbreviateAddress } from "@evefrontier/dapp-kit";
import { useQueryClient } from "@tanstack/react-query";
import { useVaultData, useWalletCredits } from "../hooks/useVaultData";
import { useRedeem } from "../hooks/useVaultTransactions";
import { useCharacter, fetchCharacter } from "../hooks/useCharacter";
import { useTokenBalances } from "../hooks/useTokenBalances";
import { useGoals } from "../context/GoalContext";
import { useContracts, type Contract } from "../context/ContractContext";
import { useTicker } from "../context/DeploymentContext";
import { useTribeTax, calcTribeTax } from "../hooks/useTribeTax";
import { useVaultId } from "../hooks/useVaultId";
import { useOffChainBalance, useOffChainBalanceMutations } from "../hooks/useOffChainBalance";
import { useSsuInventory, useSsuOnChainNames, findItemQuantity, extractItemName } from "../hooks/useSsuInventory";
import { computeTieredRewards, parseMissionDisplay, decomposeConstruct, decomposeBuild, decomposeAssemble, decomposePrint, decomposeRefine, decomposeGather, decomposeAcquire, getBuildings, getShips, getModules, getPrintItems, getRefineItems, getGatherItems, getAcquireItems, getAvailablePrinters, getAvailableRefineries, getAvailableBerths, getAvailableAssemblers, formatSourceLabel, getMissionInputs, getTypeIdByName, type StructureFilter } from "../data/supplyChain";
import { MissionIcon } from "../components/ItemIcon";
import { useWings } from "../hooks/useWings";
import { useMembers } from "../hooks/useMembers";
import { useEscrowFromEphemeral, useEscrowEphBatch, useClaim, useTrade, useReleaseBatch, usePickupBatch } from "../hooks/useEphemeralTransfer";
import { useAllocations } from "../hooks/useAllocations";
import { Select } from "../components/Select";
import { useTerritoryData } from "../hooks/useTerritoryData";
import { useDeliveryActions, useDeliveries, useIncomingDeliveries, type DeliveryItem } from "../hooks/useDelivery";
import { usePackages } from "../hooks/usePackages";
import { ssuDisplayName, buildSsuLabel, isLikelyAddress, anonSsuName } from "../utils/ssuNames";
import { useRecipes } from "../hooks/useRecipes";
import { verifyClaimDigest } from "../utils/verifyClaimDigest";
import { GOAL_TYPE_LABELS } from "../components/tribe/OperationsTab";
import { useNetworkSettings } from "../hooks/useNetworkSettings";
import { useNetworkNodeFuel } from "../hooks/useNetworkNodeFuel";
import { FuelDisplay } from "../components/FuelDisplay";
import { useCorporateInventory } from "../hooks/useCorporateInventory";

interface HomePageProps {
  /** Categories hidden during remote browsing (e.g. ["goals", "inventory"]) */
  hiddenCategories?: string[];
}

export function HomePage({ hiddenCategories }: HomePageProps) {
  const account = useCurrentAccount();
  const queryClient = useQueryClient();
  const { data: character } = useCharacter(account?.address);
  const { data: balances } = useTokenBalances(account?.address);
  const { data: vaultId } = useVaultId(character?.tribeId);
  const { data: vault } = useVaultData(vaultId);
  const { data: walletCredits } = useWalletCredits(account?.address, vault, vaultId);
  const { goals, completeMission, tribeId, ssuId, refetchGoals } = useGoals();
  const { contracts, createContract, cancelContract, acceptContract, progressMission: progressContractMission, failContract, expireContract } = useContracts();
  const ticker = useTicker();
  const [expandedGoals, setExpandedGoals] = useState<Set<number>>(new Set());
  const [opsTab, setOpsTab] = useState<"goals" | "contracts">("goals");

  // Wings — used to show wing tags on missions assigned to the user's wing
  const { wings } = useWings(ssuId, tribeId);
  const userAddress = account?.address ?? "";
  const userWingIds = wings.filter((w) => w.memberAddresses.includes(userAddress)).map((w) => w.id);

  // Allocations — for auto-allocating items to wings on mission progress
  const { allocate: allocateToWing } = useAllocations(ssuId, tribeId);

  // Auto-register: if the connected user is in this tribe but not yet on the roster, add them
  const { members, loading: membersLoading, addMember } = useMembers(ssuId, tribeId);
  const autoRegistered = useRef(false);
  useEffect(() => {
    if (autoRegistered.current) return;
    // Wait for members query to finish so we don't overwrite existing data
    if (membersLoading) return;
    if (!character || !account?.address || !ssuId || !tribeId) return;
    if (String(character.tribeId) !== String(tribeId)) return;
    if (members.some((m) => m.address === account.address)) return;
    autoRegistered.current = true;
    addMember(character.name, account.address, character.characterId);
  }, [character, account?.address, members, membersLoading, ssuId, tribeId, addMember]);

  // Off-chain earned balance
  const { data: earnedCredits } = useOffChainBalance(tribeId, account?.address);
  const { credit: creditBalance } = useOffChainBalanceMutations(tribeId, account?.address);

  // SSU inventory — ssuId is the game item_id; the hook derives the Sui object ID dynamically
  const { data: ssuInventory } = useSsuInventory(ssuId || undefined);

  // Network node fuel
  const { settings: networkSettings } = useNetworkSettings();
  const { fuel: networkFuel } = useNetworkNodeFuel(networkSettings?.networkNodeId);

  // On-chain ephemeral storage transfer hooks
  const { escrow: escrowToOpen } = useEscrowFromEphemeral(ssuId || undefined);
  const { escrowEphBatch } = useEscrowEphBatch(ssuId || undefined);
  const { claim: onChainClaim } = useClaim(ssuId || undefined);
  const { releaseBatch: onChainReleaseBatch } = useReleaseBatch(ssuId || undefined);
  const { pickupBatch: onChainPickupBatch } = usePickupBatch(ssuId || undefined);

  // Corporate inventory (off-chain bookkeeping on open storage)
  const { items: corpItems, releaseFromCorpStorage } = useCorporateInventory(ssuId || "", tribeId || "");

  // Delivery actions & incoming deliveries
  const { acceptDelivery, progressDelivery } = useDeliveryActions(ssuId || "", tribeId || "");
  const { data: outgoingDeliveries } = useDeliveries(ssuId || "", tribeId || "");
  const { data: incomingDeliveries } = useIncomingDeliveries(ssuId || "");

  // Per-mission contributing state
  const [contributing, setContributing] = useState<string | null>(null);
  const [contributeError, setContributeError] = useState<string | null>(null);

  // Delivery claim prompt state (replaces window.prompt which can be silently blocked)
  const [deliveryPrompt, setDeliveryPrompt] = useState<{
    goalId: number; missionIdx: number; reward: number;
    mission: { description: string; typeId?: number; quantity: number; phase?: string };
    done: number; max: number;
  } | null>(null);
  const [deliveryPromptQty, setDeliveryPromptQty] = useState(1);

  // Input material withdrawal prompt state
  const [withdrawPrompt, setWithdrawPrompt] = useState<{
    goalId: number; missionIdx: number;
    inputItem: { itemName: string; typeId: number };
    maxAvailable: number;
  } | null>(null);
  const [withdrawPromptQty, setWithdrawPromptQty] = useState(1);

  const publishedGoals = goals.filter((g) => g.status === "published");

  // Tick every 60s to update delivery countdown timers
  const [, setTick] = useState(0);
  useEffect(() => {
    const hasActiveDelivery = (outgoingDeliveries ?? []).some((d) => d.status === "in-transit");
    if (!hasActiveDelivery) return;
    const id = setInterval(() => setTick((t) => t + 1), 60_000);
    return () => clearInterval(id);
  }, [outgoingDeliveries]);

  // Refetch goals from the server when a delivery transitions to "delivered"
  const prevDeliveryStatuses = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    if (!outgoingDeliveries) return;
    let shouldRefetch = false;
    for (const d of outgoingDeliveries) {
      const prev = prevDeliveryStatuses.current.get(d.id);
      if (prev && prev !== "delivered" && d.status === "delivered") {
        shouldRefetch = true;
      }
    }
    // Update the ref
    const next = new Map<string, string>();
    for (const d of outgoingDeliveries) next.set(d.id, d.status);
    prevDeliveryStatuses.current = next;
    if (shouldRefetch) refetchGoals();
  }, [outgoingDeliveries, refetchGoals]);

  function toggleExpand(id: number) {
    setExpandedGoals((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /**
   * Non-owner contributes to a mission.
   * For DELIVER missions: claims items from main storage → user's ephemeral, records delivery acceptance.
   * For other phases: deposits items from user's ephemeral → main storage.
   */
  async function handleContribute(goalId: number, missionIdx: number, reward: number, mission: { description: string; typeId?: number; quantity: number; phase?: string }, done: number) {
    const key = `${goalId}-${missionIdx}`;
    setContributing(key);
    setContributeError(null);
    try {
      if (!ssuInventory) {
        setContributeError("SSU inventory not loaded yet. Click ↻ Refresh and try again.");
        return;
      }
      if (!character?.objectId || !character?.ownerCapId) {
        setContributeError("Character data not loaded. Please reconnect your wallet.");
        return;
      }

      // --- Block SSU owner from contributing to their own non-delivery missions ---
      const myCharAddr = character?.characterAddress?.toLowerCase() ?? '';
      const ssuOwnerAddr = ssuInventory.ownerId?.toLowerCase() ?? '';
      if (mission.phase !== "DELIVER" && myCharAddr && ssuOwnerAddr && myCharAddr === ssuOwnerAddr) {
        setContributeError("As the SSU owner you cannot progress your own missions. Only contributors can.");
        return;
      }

      const remaining = mission.quantity - done;

      // ─── DELIVER phase: show quantity prompt, then claim on confirm ───
      if (mission.phase === "DELIVER") {
        setDeliveryPrompt({ goalId, missionIdx, reward, mission, done, max: remaining });
        setDeliveryPromptQty(remaining);
        setContributing(null); // release the button while the prompt is open
        return;
      }

      // ─── Standard flow (GATHER, REFINE, PRINT, ACQUIRE): ephemeral → main ───

      // --- Find the user's ephemeral inventory ---
      const myOwnerCapId = character.ownerCapId;
      let userEphemeral = myOwnerCapId
        ? ssuInventory.ephemeralByOwner.get(myOwnerCapId.toLowerCase())
        : undefined;

      // Fallback: if ownerCapId didn't match a specific slot, search all
      if (!userEphemeral || userEphemeral.length === 0) {
        userEphemeral = ssuInventory.allEphemeral;
      }

      const itemName = extractItemName(mission.description);
      console.log("[contribute] checking:", {
        desc: mission.description, itemName, typeId: mission.typeId,
        myOwnerCapId, ephKeys: [...ssuInventory.ephemeralByOwner.keys()],
      });

      // --- Find how many of this item the user has deposited ---
      const deposited = findItemQuantity(userEphemeral, mission.typeId, itemName);
      if (deposited <= 0) {
        const what = itemName ?? `type #${mission.typeId}`;
        const diagKeys = [...ssuInventory.ephemeralByOwner.keys()].length;
        const diagTotal = ssuInventory.allEphemeral.length;
        setContributeError(
          `"${what}" not found in your ephemeral storage. Deposit items to the SSU first. ` +
          `(Your cap: ${myOwnerCapId?.slice(0, 10)}…, ${diagKeys} inventory slot(s), ${diagTotal} total ephemeral item(s))`
        );
        return;
      }

      // --- Progress by the correct amount ---
      const progressAmt = Math.min(deposited, remaining);
      if (progressAmt <= 0) return;

      console.log(`[contribute] ✓ Verified ${deposited} deposited, progressing by ${progressAmt} (remaining: ${remaining})`);

      // --- On-chain transfer: ephemeral → open storage (corp, hidden from game UI) ---
      if (mission.typeId && mission.typeId > 0) {
        try {
          const ok = await escrowToOpen(
            character.objectId,
            character.ownerCapId,
            mission.typeId,
            progressAmt,
          );
          if (ok) {
            // Short delay so the Sui indexer can process the tx before we refetch
            setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
          } else {
            console.warn("[contribute] On-chain transfer failed (extension may not be authorized). Proceeding off-chain.");
          }
        } catch (e) {
          console.warn("[contribute] On-chain transfer error, proceeding off-chain:", e);
        }
      }

      // Credit off-chain balance proportionally
      const perUnit = remaining > 0 ? reward / remaining : 0;
      const totalReward = Math.round(perUnit * progressAmt);

      // Record completion by the verified amount and deduct reward from goal budget
      completeMission(goalId, missionIdx, progressAmt, totalReward);

      if (totalReward > 0) {
        await creditBalance(totalReward);
      }

      // ─── Feature: auto-allocate deposited items to wings ───
      // Check if the deposited item (mission output) is an input material for
      // any wing-assigned mission across all published goals on this SSU.
      const depositedItemName = extractItemName(mission.description);
      const depositedTypeId = mission.typeId ?? (depositedItemName ? getTypeIdByName(depositedItemName) : 0);
      if (depositedTypeId && depositedItemName) {
        for (const g of publishedGoals) {
          for (let mi = 0; mi < g.missions.length; mi++) {
            if (!g.publishedMissions.has(mi)) continue;
            const wingIds = g.missionWings?.[mi] ?? [];
            if (wingIds.length === 0) continue;
            const inputs = getMissionInputs(g.missions[mi]);
            const match = inputs.find(
              (inp) => inp.typeId === depositedTypeId,
            );
            if (match) {
              for (const wid of wingIds) {
                try {
                  await allocateToWing(
                    depositedTypeId,
                    depositedItemName,
                    wid,
                    progressAmt,
                    account?.address ?? "system",
                  );
                  console.log(`[auto-alloc] Allocated ${progressAmt} ${depositedItemName} to wing ${wid}`);
                } catch (e) {
                  console.warn("[auto-alloc] Failed to allocate:", e);
                }
              }
            }
          }
        }
      }

      setContributeError(null);
    } catch (err) {
      console.error("[handleContribute] error:", err);
      setContributeError(`Error: ${(err as Error).message || "Unknown error"}`);
    } finally {
      setContributing(null);
    }
  }

  /**
   * Called when user confirms the delivery quantity prompt (single-item deliveries).
   * Checks main storage first, then falls back to corporate/open storage.
   * Non-owners: claims items → user's ephemeral. SSU owners: skip on-chain claim.
   */
  async function handleDeliveryClaim() {
    const p = deliveryPrompt;
    if (!p) return;
    const claimQty = Math.min(Math.max(1, deliveryPromptQty), p.max);
    if (claimQty <= 0) return;
    setDeliveryPrompt(null);

    const key = `${p.goalId}-${p.missionIdx}`;
    setContributing(key);
    setContributeError(null);
    try {
      if (!ssuInventory || !character?.objectId || !character?.ownerCapId) {
        setContributeError("Character or SSU data not loaded. Please refresh.");
        return;
      }

      const itemName = extractItemName(p.mission.description);
      const mainAvailable = findItemQuantity(ssuInventory.mainItems, p.mission.typeId, itemName);

      // Check corporate/open storage as fallback
      const openAvailable = findItemQuantity(ssuInventory.openStorageItems, p.mission.typeId, itemName);
      const corpItem = corpItems.find((c) => c.typeId === p.mission.typeId);
      const corpAvailable = Math.min(openAvailable, corpItem?.quantity ?? 0);
      const totalAvailable = mainAvailable + corpAvailable;

      if (totalAvailable < claimQty) {
        setContributeError(
          `Only ${totalAvailable} available (${mainAvailable} main + ${corpAvailable} corporate). Need ${claimQty}.`,
        );
        return;
      }

      const myCharAddr = character?.characterAddress?.toLowerCase() ?? '';
      const ssuOwnerAddr = ssuInventory.ownerId?.toLowerCase() ?? '';
      const isSsuOwner = myCharAddr && ssuOwnerAddr && myCharAddr === ssuOwnerAddr;

      // Determine how many to take from main vs corporate
      const fromMain = Math.min(mainAvailable, claimQty);
      const fromCorp = claimQty - fromMain;

      let claimDigest: string | null = null;

      if (!isSsuOwner && p.mission.typeId && p.mission.typeId > 0) {
        // Single PTB: release corporate items (open→main) + claim (main→ephemeral)
        const releaseItems = fromCorp > 0 ? [{ typeId: p.mission.typeId, quantity: fromCorp }] : [];
        const claimItems = [{ typeId: p.mission.typeId, quantity: claimQty }];
        try {
          claimDigest = await onChainPickupBatch(
            character.objectId, character.ownerCapId,
            releaseItems, claimItems,
          );
          if (!claimDigest) { setContributeError("On-chain pickup failed. Please try again."); return; }
          if (fromCorp > 0) await releaseFromCorpStorage(p.mission.typeId, itemName ?? "", fromCorp);
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
        } catch (e) {
          console.error("[delivery-claim] Pickup error:", e);
          setContributeError(`Pickup failed: ${(e as Error).message}`);
          return;
        }
      } else if (isSsuOwner && fromCorp > 0) {
        // SSU owner: just release corporate items back to main
        try {
          const ok = await onChainReleaseBatch(
            character.objectId, character.ownerCapId,
            [{ typeId: p.mission.typeId!, quantity: fromCorp }],
          );
          if (ok) await releaseFromCorpStorage(p.mission.typeId!, itemName ?? "", fromCorp);
        } catch (e) {
          console.warn("[delivery-claim] Owner release error:", e);
        }
      }

      // Off-chain: accept the delivery (links courier to delivery record)
      const goal = goals.find((g) => g.id === p.goalId);
      let delId = goal?.deliveryId;
      if (!delId && outgoingDeliveries) {
        const linked = outgoingDeliveries.find(
          (d) => d.sourceType === "goal" && d.sourceId === String(p.goalId),
        );
        delId = linked?.id;
      }
      if (delId && account?.address) {
        try {
          await acceptDelivery(delId, account.address, character.name ?? "Unknown", claimDigest ?? undefined);
        } catch (e) {
          console.warn("[delivery] Failed to accept delivery off-chain:", e);
        }
      }

      setContributeError(null);
    } catch (err) {
      console.error("[handleDeliveryClaim] error:", err);
      setContributeError(`Error: ${(err as Error).message || "Unknown error"}`);
    } finally {
      setContributing(null);
    }
  }

  /**
   * Batch-claim ALL items for a package-linked delivery goal at once.
   * Checks main + corporate/open storage for each item, does release_to_main if needed,
   * then batch claim_supply for all items in a single PTB.
   */
  async function handleDeliveryPackageClaim(goalId: number) {
    const key = `package-${goalId}`;
    setContributing(key);
    setContributeError(null);
    try {
      if (!ssuInventory || !character?.objectId || !character?.ownerCapId) {
        setContributeError("Character or SSU data not loaded. Please refresh.");
        return;
      }
      if (!account?.address) { setContributeError("Wallet not connected."); return; }

      const goal = goals.find((g) => g.id === goalId);
      if (!goal) { setContributeError("Goal not found."); return; }

      // Find the linked delivery
      let delId = goal.deliveryId;
      const delivery = (outgoingDeliveries ?? []).find(
        (d) => d.id === delId || (d.sourceType === "goal" && d.sourceId === String(goalId)),
      );
      if (!delivery) { setContributeError("No linked delivery found for this goal."); return; }
      delId = delivery.id;

      // Collect all DELIVER missions and their remaining quantities
      const deliverMissions = goal.missions
        .map((m, i) => ({ ...m, idx: i, done: goal.completed.get(i) ?? 0 }))
        .filter((m) => m.phase === "DELIVER" && m.done < m.quantity);

      if (deliverMissions.length === 0) { setContributeError("All delivery items already picked up."); return; }

      const myCharAddr = character.characterAddress?.toLowerCase() ?? '';
      const ssuOwnerAddr = ssuInventory.ownerId?.toLowerCase() ?? '';
      const isSsuOwner = myCharAddr && ssuOwnerAddr && myCharAddr === ssuOwnerAddr;

      // For each item, determine source (main vs corporate) and quantity
      const itemsToClaim: { typeId: number; quantity: number; itemName: string }[] = [];
      const corpReleases: { typeId: number; quantity: number; itemName: string }[] = [];

      for (const m of deliverMissions) {
        const remaining = m.quantity - m.done;
        const itemName = extractItemName(m.description) ?? "";
        const mainQty = findItemQuantity(ssuInventory.mainItems, m.typeId, itemName);
        const openQty = findItemQuantity(ssuInventory.openStorageItems, m.typeId, itemName);
        const corpItem = corpItems.find((c) => c.typeId === m.typeId);
        const corpQty = Math.min(openQty, corpItem?.quantity ?? 0);
        const totalQty = mainQty + corpQty;

        if (totalQty < remaining) {
          setContributeError(
            `"${itemName || `type #${m.typeId}`}" — only ${totalQty} available (need ${remaining}).`,
          );
          return;
        }

        const fromMain = Math.min(mainQty, remaining);
        const fromCorp = remaining - fromMain;
        if (fromCorp > 0) {
          corpReleases.push({ typeId: m.typeId!, quantity: fromCorp, itemName });
        }
        if (m.typeId && m.typeId > 0) {
          itemsToClaim.push({ typeId: m.typeId, quantity: remaining, itemName });
        }
      }

      let claimDigest: string | null = null;

      if (!isSsuOwner) {
        // Single PTB: release corporate items (open→main) + claim all (main→ephemeral)
        const releaseItems = corpReleases.map((r) => ({ typeId: r.typeId, quantity: r.quantity }));
        const claimItems = itemsToClaim.map((it) => ({ typeId: it.typeId, quantity: it.quantity }));
        try {
          claimDigest = await onChainPickupBatch(
            character.objectId, character.ownerCapId,
            releaseItems, claimItems,
          );
          if (!claimDigest) { setContributeError("On-chain package pickup failed. Please try again."); return; }
          for (const r of corpReleases) {
            await releaseFromCorpStorage(r.typeId, r.itemName, r.quantity);
          }
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
        } catch (e) {
          console.error("[package-claim] Pickup error:", e);
          setContributeError(`Package pickup failed: ${(e as Error).message}`);
          return;
        }
      } else if (corpReleases.length > 0) {
        // SSU owner: release corporate items back to main
        try {
          const ok = await onChainReleaseBatch(
            character.objectId, character.ownerCapId,
            corpReleases.map((r) => ({ typeId: r.typeId, quantity: r.quantity })),
          );
          if (ok) {
            for (const r of corpReleases) {
              await releaseFromCorpStorage(r.typeId, r.itemName, r.quantity);
            }
          }
        } catch (e) {
          console.warn("[package-claim] Owner release error:", e);
        }
      }

      // Off-chain: accept the delivery
      try {
        await acceptDelivery(delId!, account.address, character.name ?? "Unknown", claimDigest ?? undefined);
      } catch (e) {
        console.warn("[package-claim] Failed to accept delivery off-chain:", e);
      }

      queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] });
      setContributeError(null);
    } catch (err) {
      console.error("[handleDeliveryPackageClaim] error:", err);
      setContributeError(`Error: ${(err as Error).message || "Unknown error"}`);
    } finally {
      setContributing(null);
    }
  }

  /**
   * Complete a delivery at the destination SSU.
   * For couriers: transfers items from ephemeral → SSU main, then records deposit.
   * For SSU owners: verifies the courier's claim TX digest on-chain instead.
   */
  async function handleDeliveryComplete(deliveryId: string, item: DeliveryItem) {
    const key = `delivery-${deliveryId}-${item.typeId}`;
    setContributing(key);
    setContributeError(null);
    try {
      if (!character?.objectId || !character?.ownerCapId) {
        setContributeError("Character data not loaded. Please reconnect your wallet.");
        return;
      }

      // Try ephemeral-based flow first (courier has items)
      let usedEphemeral = false;
      if (ssuInventory) {
        const myOwnerCapId = character.ownerCapId;
        let userEphemeral = myOwnerCapId
          ? ssuInventory.ephemeralByOwner.get(myOwnerCapId.toLowerCase())
          : undefined;
        if (!userEphemeral || userEphemeral.length === 0) {
          userEphemeral = ssuInventory.allEphemeral;
        }

        const deposited = findItemQuantity(userEphemeral, item.typeId, item.itemName);
        if (deposited > 0) {
          usedEphemeral = true;
          const qty = Math.min(deposited, item.quantity);

          // On-chain: escrow to open storage (corp, hidden from game UI)
          if (item.typeId > 0) {
            try {
              const ok = await escrowToOpen(
                character.objectId,
                character.ownerCapId,
                item.typeId,
                qty,
              );
              if (ok) {
                setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
              } else {
                console.warn("[delivery-complete] On-chain escrow failed, proceeding off-chain.");
              }
            } catch (e) {
              console.warn("[delivery-complete] On-chain error:", e);
            }
          }

          // Off-chain: record deposit
          if (account?.address) {
            try {
              await progressDelivery(deliveryId, account.address, [
                { typeId: item.typeId, itemName: item.itemName, quantity: qty },
              ]);
            } catch (e) {
              console.warn("[delivery-complete] Failed to record progress:", e);
            }
          }
        }
      }

      // Fallback for SSU owner: check main storage instead of ephemeral
      if (!usedEphemeral && ssuInventory) {
        const myCharAddr = character?.characterAddress?.toLowerCase() ?? '';
        const ssuOwnerAddr = ssuInventory.ownerId?.toLowerCase() ?? '';
        if (myCharAddr && ssuOwnerAddr && myCharAddr === ssuOwnerAddr) {
          const mainQty = findItemQuantity(ssuInventory.mainItems, item.typeId, item.itemName);
          if (mainQty > 0) {
            usedEphemeral = true; // reuse flag to skip TX-digest fallback
            const qty = Math.min(mainQty, item.quantity);

            // Off-chain: record deposit (no on-chain transfer needed — items are already in main storage)
            if (account?.address) {
              try {
                await progressDelivery(deliveryId, account.address, [
                  { typeId: item.typeId, itemName: item.itemName, quantity: qty },
                ]);
              } catch (e) {
                console.warn("[delivery-complete] Failed to record owner progress:", e);
              }
            }
          }
        }
      }

      // Fallback: verify via TX digest (SSU owner or no ephemeral items)
      if (!usedEphemeral) {
        const delivery = (incomingDeliveries ?? []).find((d) => d.id === deliveryId);
        const courier = delivery?.couriers.find((c) => c.status === "in-transit" && c.claimDigest);
        if (!courier?.claimDigest) {
          setContributeError(
            `"${item.itemName}" not found in ephemeral storage and no claim TX to verify. ` +
            `The courier must claim items at the source SSU first.`,
          );
          return;
        }

        // Verify the claim TX on-chain
        const verification = await verifyClaimDigest(courier.claimDigest);
        if (!verification.valid) {
          setContributeError(`Delivery verification failed: ${verification.error}`);
          return;
        }

        // TX verified — record the deposit off-chain using the courier's wallet
        try {
          await progressDelivery(deliveryId, courier.courierWallet, [
            { typeId: item.typeId, itemName: item.itemName, quantity: item.quantity },
          ]);
        } catch (e) {
          console.warn("[delivery-complete] Failed to record verified progress:", e);
        }
      }

      setContributeError(null);
    } catch (err) {
      console.error("[handleDeliveryComplete] error:", err);
      setContributeError(`Error: ${(err as Error).message || "Unknown error"}`);
    } finally {
      setContributing(null);
    }
  }

  /**
   * Deliver an entire package at the destination SSU in one action.
   * Verifies all manifest items are in ephemeral, escrows them all to open storage,
   * then records progress for every item at once. The server will recreate the package
   * at the destination tribe's corporate storage.
   */
  async function handleDeliveryPackageComplete(deliveryId: string) {
    const key = `package-deliver-${deliveryId}`;
    setContributing(key);
    setContributeError(null);
    try {
      if (!character?.objectId || !character?.ownerCapId) {
        setContributeError("Character data not loaded. Please reconnect your wallet.");
        return;
      }
      if (!account?.address) { setContributeError("Wallet not connected."); return; }

      const delivery = (incomingDeliveries ?? []).find((d) => d.id === deliveryId);
      if (!delivery) { setContributeError("Delivery not found."); return; }

      const courier = delivery.couriers.find(
        (c) => c.courierWallet === account.address && c.status === "in-transit",
      );
      if (!courier) { setContributeError("You are not an active courier for this delivery."); return; }

      // Determine remaining items to deposit
      const itemsToDeposit: { typeId: number; itemName: string; quantity: number }[] = [];
      for (const item of delivery.items) {
        const deposited = courier.itemsDeposited.find((dep) => dep.typeId === item.typeId);
        const remaining = item.quantity - (deposited?.quantity ?? 0);
        if (remaining > 0) {
          itemsToDeposit.push({ typeId: item.typeId, itemName: item.itemName, quantity: remaining });
        }
      }

      if (itemsToDeposit.length === 0) {
        setContributeError("All items already deposited.");
        return;
      }

      // Detect SSU owner
      const myCharAddr = character?.characterAddress?.toLowerCase() ?? '';
      const ssuOwnerAddr = ssuInventory?.ownerId?.toLowerCase() ?? '';
      const isSsuOwner = myCharAddr && ssuOwnerAddr && myCharAddr === ssuOwnerAddr;

      let usedEphemeral = false;

      // Try ephemeral storage first (non-owner path)
      if (ssuInventory) {
        const myOwnerCapId = character.ownerCapId;
        let userEphemeral = myOwnerCapId
          ? ssuInventory.ephemeralByOwner.get(myOwnerCapId.toLowerCase())
          : undefined;
        if (!userEphemeral || userEphemeral.length === 0) {
          userEphemeral = ssuInventory.allEphemeral;
        }

        const allInEphemeral = itemsToDeposit.every((item) =>
          findItemQuantity(userEphemeral, item.typeId, item.itemName) >= item.quantity,
        );

        if (allInEphemeral) {
          usedEphemeral = true;
          // On-chain: batch escrow all items from ephemeral → open storage
          const escrowItems = itemsToDeposit
            .filter((it) => it.typeId > 0)
            .map((it) => ({ typeId: it.typeId, quantity: it.quantity }));

          if (escrowItems.length > 0) {
            try {
              const ok = await escrowEphBatch(
                character.objectId,
                character.ownerCapId,
                escrowItems,
              );
              if (!ok) {
                setContributeError("On-chain batch escrow failed. Please try again.");
                return;
              }
              setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
            } catch (e) {
              console.error("[package-deliver] Batch escrow error:", e);
              setContributeError(`Package delivery failed: ${(e as Error).message}`);
              return;
            }
          }
        }
      }

      // SSU owner fallback: items are already in main storage, no on-chain transfer needed
      if (!usedEphemeral && isSsuOwner && ssuInventory) {
        const allInMain = itemsToDeposit.every((item) =>
          findItemQuantity(ssuInventory.mainItems, item.typeId, item.itemName) >= item.quantity,
        );

        if (allInMain) {
          usedEphemeral = true; // reuse flag to skip error
        } else {
          // Check what's missing
          for (const item of itemsToDeposit) {
            const available = findItemQuantity(ssuInventory.mainItems, item.typeId, item.itemName);
            if (available < item.quantity) {
              setContributeError(
                `"${item.itemName}" — only ${available} in main storage (need ${item.quantity}).`,
              );
              return;
            }
          }
        }
      }

      if (!usedEphemeral) {
        // Neither ephemeral nor main storage had the items
        for (const item of itemsToDeposit) {
          const ephAvail = ssuInventory
            ? findItemQuantity(ssuInventory.allEphemeral, item.typeId, item.itemName)
            : 0;
          if (ephAvail < item.quantity) {
            setContributeError(
              `"${item.itemName}" — only ${ephAvail} in ephemeral (need ${item.quantity}). ` +
              `Make sure all package items are in your ephemeral storage at this SSU.`,
            );
            return;
          }
        }
      }

      // Off-chain: record all deposited items at once
      try {
        await progressDelivery(deliveryId, account.address, itemsToDeposit);
      } catch (e) {
        console.warn("[package-deliver] Failed to record progress:", e);
      }

      queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] });
      queryClient.invalidateQueries({ queryKey: ["incoming-deliveries"] });
      setContributeError(null);
    } catch (err) {
      console.error("[handleDeliveryPackageComplete] error:", err);
      setContributeError(`Error: ${(err as Error).message || "Unknown error"}`);
    } finally {
      setContributing(null);
    }
  }

  /**
   * SSU owner verifies an entire package delivery at once via the courier's claim TX digest.
   * Records all remaining items as deposited in a single call.
   */
  async function handleVerifyPackageDelivery(deliveryId: string) {
    const key = `package-verify-${deliveryId}`;
    setContributing(key);
    setContributeError(null);
    try {
      const delivery = (incomingDeliveries ?? []).find((d) => d.id === deliveryId);
      if (!delivery) { setContributeError("Delivery not found."); return; }

      const courier = delivery.couriers.find((c) => c.status === "in-transit" && c.claimDigest);
      if (!courier?.claimDigest) {
        setContributeError("No claim TX to verify. The courier must pick up items at the source SSU first.");
        return;
      }

      // Verify the claim TX on-chain
      const verification = await verifyClaimDigest(courier.claimDigest);
      if (!verification.valid) {
        setContributeError(`Delivery verification failed: ${verification.error}`);
        return;
      }

      // Determine remaining items to record
      const itemsToRecord: { typeId: number; itemName: string; quantity: number }[] = [];
      for (const item of delivery.items) {
        const deposited = courier.itemsDeposited.find((dep) => dep.typeId === item.typeId);
        const remaining = item.quantity - (deposited?.quantity ?? 0);
        if (remaining > 0) {
          itemsToRecord.push({ typeId: item.typeId, itemName: item.itemName, quantity: remaining });
        }
      }

      if (itemsToRecord.length === 0) {
        setContributeError("All items already verified.");
        return;
      }

      // TX verified — record all deposits at once
      try {
        await progressDelivery(deliveryId, courier.courierWallet, itemsToRecord);
      } catch (e) {
        console.warn("[verify-package] Failed to record verified progress:", e);
      }

      queryClient.invalidateQueries({ queryKey: ["incoming-deliveries"] });
      setContributeError(null);
    } catch (err) {
      console.error("[handleVerifyPackageDelivery] error:", err);
      setContributeError(`Error: ${(err as Error).message || "Unknown error"}`);
    } finally {
      setContributing(null);
    }
  }

  /**
   * Open the withdrawal prompt for a mission's input materials.
   * Checks: wing membership (if assigned), SSU owner block, item availability in main storage.
   */
  function handleWithdrawOpen(goalId: number, missionIdx: number, inputItem: { itemName: string; typeId: number }, goal: typeof publishedGoals[0]) {
    setContributeError(null);

    // SSU owner cannot withdraw (same rule as progressing)
    const myCharAddr = character?.characterAddress?.toLowerCase() ?? '';
    const ssuOwnerAddr = ssuInventory?.ownerId?.toLowerCase() ?? '';
    if (myCharAddr && ssuOwnerAddr && myCharAddr === ssuOwnerAddr) {
      setContributeError("As the SSU owner you cannot withdraw mission materials.");
      return;
    }

    // Wing access check
    const wingIds = goal.missionWings?.[missionIdx] ?? [];
    if (wingIds.length > 0 && !wingIds.some((wId) => userWingIds.includes(wId))) {
      setContributeError("Only members of the assigned wing can withdraw materials for this mission.");
      return;
    }

    // Check availability in SSU main storage
    if (!ssuInventory) {
      setContributeError("SSU inventory not loaded. Please refresh.");
      return;
    }
    const available = findItemQuantity(ssuInventory.mainItems, inputItem.typeId, inputItem.itemName);
    if (available <= 0) {
      setContributeError(`No "${inputItem.itemName}" available in SSU main storage.`);
      return;
    }

    setWithdrawPrompt({ goalId, missionIdx, inputItem, maxAvailable: available });
    setWithdrawPromptQty(available);
  }

  /**
   * Confirm input material withdrawal: claim_supply on-chain (main → ephemeral).
   * No mission progress or balance changes — just physical item movement.
   */
  async function handleInputWithdrawConfirm() {
    const p = withdrawPrompt;
    if (!p) return;
    const qty = Math.min(Math.max(1, withdrawPromptQty), p.maxAvailable);
    if (qty <= 0) return;
    setWithdrawPrompt(null);

    const key = `withdraw-${p.goalId}-${p.missionIdx}`;
    setContributing(key);
    setContributeError(null);
    try {
      if (!character?.objectId || !character?.ownerCapId) {
        setContributeError("Character data not loaded. Please reconnect your wallet.");
        return;
      }

      // On-chain: claim_supply (main → user's ephemeral)
      try {
        const digest = await onChainClaim(
          character.objectId,
          character.ownerCapId,
          p.inputItem.typeId,
          qty,
        );
        if (!digest) {
          setContributeError("On-chain withdrawal failed. Please try again.");
          return;
        }
        setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
      } catch (e) {
        console.error("[input-withdraw] On-chain claim error:", e);
        setContributeError(`Withdrawal failed: ${(e as Error).message}`);
        return;
      }

      setContributeError(null);
    } catch (err) {
      console.error("[handleInputWithdraw] error:", err);
      setContributeError(`Error: ${(err as Error).message || "Unknown error"}`);
    } finally {
      setContributing(null);
    }
  }

  const characterName = character?.name ?? (account ? abbreviateAddress(account.address) : "—");
  const tribeName = character
    ? (character.tribeName ?? `Tribe ${character.tribeId}`)
    : "—";
  const totalBudgetRemaining = publishedGoals.reduce((s, g) => s + Math.max(0, g.budget - (g.budgetAwarded ?? 0)), 0);
  const displayEarned = earnedCredits ?? 0;
  const displayWallet = walletCredits ? walletCredits.credits / 1e9 : 0;
  const hiddenSet = new Set(hiddenCategories ?? []);

  return (
    <>
    <div className="page-grid">
      {/* Left: Pilot Overview */}
      <div>
        <section className="panel">
          <h3>Pilot Overview</h3>
          <div className="stat-grid">
            <div className="stat">
              <span className="stat-label">Character</span>
              <span className="stat-value" style={{ fontSize: "0.9rem" }}>{characterName}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Tribe</span>
              <span className="stat-value" style={{ fontSize: "0.9rem" }}>{tribeName}</span>
            </div>
            <div className="stat">
              <span className="stat-label">SUI Balance</span>
              <span className="stat-value">{balances ? (balances.sui ?? 0).toFixed(4) : "—"}</span>
            </div>
            <div className="stat">
              <span className="stat-label">EVE Balance</span>
              <span className="stat-value">{balances ? (balances.eve ?? 0).toFixed(4) : "—"}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Earned {ticker}</span>
              <span className="stat-value stat-earned">{displayEarned.toLocaleString()}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Wallet {ticker}</span>
              <span className="stat-value">{displayWallet ? displayWallet.toLocaleString() : "—"}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Active Bounties</span>
              <span className="stat-value">{totalBudgetRemaining.toLocaleString()}</span>
            </div>
          </div>
          {ssuInventory?.assemblyId && (
            <div style={{ marginTop: "0.5rem", padding: "0.4rem 0.6rem", background: "rgba(255,255,255,0.04)", borderRadius: 4 }}>
              <span className="stat-label" style={{ fontSize: "0.7rem" }}>SSU Assembly ID</span>
              <div style={{ fontSize: "0.65rem", wordBreak: "break-all", opacity: 0.7, marginTop: 2 }}>
                {ssuInventory.assemblyId}
              </div>
            </div>
          )}
          {networkFuel && !hiddenSet.has("fuel") && (
            <div style={{ marginTop: "0.5rem", padding: "0.4rem 0.6rem", background: "rgba(255,255,255,0.04)", borderRadius: 4 }}>
              <span className="stat-label" style={{ fontSize: "0.7rem" }}>Network Node Fuel</span>
              <div style={{ marginTop: 4 }}>
                <FuelDisplay
                  percent={networkFuel.percent}
                  msRemaining={networkFuel.msRemaining}
                  isBurning={networkFuel.isBurning}
                  quantity={networkFuel.quantity}
                  timeRemainingLabel={networkFuel.timeRemainingLabel}
                />
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Right: Ticker Summary */}
      <div>
        <section className="panel">
          <h3>{ticker} Summary</h3>
          <div className="balance-summary">
            <div className="balance-row">
              <span className="balance-label">Earned (off-chain)</span>
              <span className="balance-value earned">{displayEarned.toLocaleString()}</span>
            </div>
            <div className="balance-row">
              <span className="balance-label">Wallet (on-chain)</span>
              <span className="balance-value">{displayWallet ? displayWallet.toLocaleString() : "0"}</span>
            </div>
            <div className="balance-row balance-total">
              <span className="balance-label">Total</span>
              <span className="balance-value">{(displayEarned + displayWallet).toLocaleString()}</span>
            </div>
          </div>
          <p className="muted" style={{ marginTop: "0.75rem", fontSize: "0.75rem" }}>
            Earned credits can be withdrawn to your wallet on the Exchange page.
          </p>
        </section>
      </div>
    </div>

    {/* Full-width Operations panel */}
    {!hiddenSet.has("goals") && (
      <section className="panel" style={{ marginTop: "1rem" }}>
        <div className="panel-header-row">
          <h3>Operations</h3>
            <button
              className="btn-subtle"
              style={{ fontSize: "0.7rem" }}
              title="Refresh SSU inventory"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] })}
            >
              ↻ Refresh
            </button>
          </div>

          {/* Sub-tabs: Goals | Contracts */}
          <div className="ops-sub-tabs">
            <button className={`ops-sub-tab${opsTab === "goals" ? " active" : ""}`} onClick={() => setOpsTab("goals")}>Goals</button>
            <button className={`ops-sub-tab${opsTab === "contracts" ? " active" : ""}`} onClick={() => setOpsTab("contracts")}>Contracts</button>
          </div>

          {contributeError && (
            <p className="error" style={{ marginBottom: "0.5rem" }}>{contributeError}</p>
          )}

          {/* ── Delivery quantity prompt (React modal, replaces window.prompt) ── */}
          {deliveryPrompt && (
            <div className="modal-overlay" onClick={() => setDeliveryPrompt(null)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
                <div className="modal-header">
                  <h3>📦 Take Items for Delivery</h3>
                  <button className="modal-close" onClick={() => setDeliveryPrompt(null)}>✕</button>
                </div>
                <div style={{ padding: "0.75rem 1rem" }}>
                  <p style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
                    {extractItemName(deliveryPrompt.mission.description) ?? `Item #${deliveryPrompt.mission.typeId}`}
                  </p>
                  <div className="input-row" style={{ gap: "0.5rem" }}>
                    <label style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>Quantity:</label>
                    <input
                      type="number"
                      min={1}
                      max={deliveryPrompt.max}
                      value={deliveryPromptQty}
                      onChange={(e) => setDeliveryPromptQty(Math.max(1, Math.min(deliveryPrompt.max, Number(e.target.value) || 1)))}
                      style={{ width: "5rem", textAlign: "center" }}
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") handleDeliveryClaim(); }}
                    />
                    <span className="muted" style={{ fontSize: "0.75rem" }}>max {deliveryPrompt.max}</span>
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }}>
                    <button className="btn-subtle" onClick={() => setDeliveryPrompt(null)}>Cancel</button>
                    <button className="btn-primary" onClick={handleDeliveryClaim}>Take for Delivery</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Input material withdrawal prompt ── */}
          {withdrawPrompt && (
            <div className="modal-overlay" onClick={() => setWithdrawPrompt(null)}>
              <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 360 }}>
                <div className="modal-header">
                  <h3>🔽 Withdraw Input Materials</h3>
                  <button className="modal-close" onClick={() => setWithdrawPrompt(null)}>✕</button>
                </div>
                <div style={{ padding: "0.75rem 1rem" }}>
                  <p style={{ fontSize: "0.85rem", marginBottom: "0.5rem" }}>
                    {withdrawPrompt.inputItem.itemName}
                  </p>
                  <div className="input-row" style={{ gap: "0.5rem" }}>
                    <label style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>Quantity:</label>
                    <input
                      type="number"
                      min={1}
                      max={withdrawPrompt.maxAvailable}
                      value={withdrawPromptQty}
                      onChange={(e) => setWithdrawPromptQty(Math.max(1, Math.min(withdrawPrompt.maxAvailable, Number(e.target.value) || 1)))}
                      style={{ width: "5rem", textAlign: "center" }}
                      autoFocus
                      onKeyDown={(e) => { if (e.key === "Enter") handleInputWithdrawConfirm(); }}
                    />
                    <span className="muted" style={{ fontSize: "0.75rem" }}>max {withdrawPrompt.maxAvailable}</span>
                  </div>
                  <p className="muted" style={{ fontSize: "0.7rem", marginTop: "0.5rem" }}>
                    Items will be moved from SSU main storage to your ephemeral storage.
                  </p>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.5rem", marginTop: "0.75rem" }}>
                    <button className="btn-subtle" onClick={() => setWithdrawPrompt(null)}>Cancel</button>
                    <button className="btn-primary" onClick={handleInputWithdrawConfirm}>Withdraw</button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {opsTab === "goals" && (<>

          {/* ── Incoming deliveries: show missions the user accepted for delivery TO this SSU ── */}
          {(() => {
            const myWallet = account?.address ?? "";
            const myDeliveries = (incomingDeliveries ?? []).filter((d) =>
              d.status === "in-transit" &&
              d.couriers.some((c) => c.courierWallet === myWallet && c.status === "in-transit"),
            );
            if (myDeliveries.length === 0) return null;
            return (
              <>
                <h4 style={{ margin: "0.5rem 0 0.25rem", fontSize: "0.85rem", color: "var(--color-accent)" }}>
                  📦 My Deliveries (incoming)
                </h4>
                {myDeliveries.map((d) => {
                  const courier = d.couriers.find((c) => c.courierWallet === myWallet && c.status === "in-transit");
                  if (!courier) return null;
                  const isPackage = !!d.packageId;
                  const allDeposited = d.items.every((item) => {
                    const dep = courier.itemsDeposited.find((x) => x.typeId === item.typeId);
                    return (dep?.quantity ?? 0) >= item.quantity;
                  });
                  const isPackageWorking = contributing === `package-deliver-${d.id}`;
                  return (
                    <div key={d.id} className="goal-card" style={{ borderLeft: "3px solid var(--color-accent)" }}>
                      <div className="goal-header">
                        <span className="goal-type">{isPackage ? "📦 Package Delivery" : "📦 Deliver"}</span>
                        <span className="goal-desc">
                          From {d.destinationLabel || d.ssuId.slice(0, 10)} → this SSU
                        </span>
                      </div>
                      <div className="rolodex-container">
                        {d.items.map((item, idx) => {
                          const deposited = courier.itemsDeposited.find(
                            (dep) => dep.typeId === item.typeId,
                          );
                          const depositedQty = deposited?.quantity ?? 0;
                          const remaining = item.quantity - depositedQty;
                          const isComplete = remaining <= 0;
                          const isWorking = contributing === `delivery-${d.id}-${item.typeId}`;
                          return (
                            <div
                              key={idx}
                              className={`rolodex-card phase-deliver-card${isComplete ? " mission-complete-card" : ""}`}
                            >
                              <div className="rc-header">
                                <span className="rc-phase phase-deliver">Deliver</span>
                                <span className="rc-progress">
                                  {depositedQty}/{item.quantity}
                                </span>
                                {isComplete && <span className="rc-done-badge">DONE</span>}
                              </div>
                              <div className="rc-desc">
                                <MissionIcon typeId={item.typeId} phase="DELIVER" size={18} />
                                {item.itemName}
                              </div>
                              {!isPackage && (
                                <div className="rc-req">
                                  Deposit to this SSU's ephemeral, then click + to transfer
                                </div>
                              )}
                              {!isPackage && !isComplete && (
                                <div className="rc-controls">
                                  <button
                                    className="btn-contribute"
                                    disabled={isWorking}
                                    title="Transfer items from your ephemeral to SSU main storage"
                                    onClick={() =>
                                      handleDeliveryComplete(d.id, {
                                        ...item,
                                        quantity: remaining,
                                      })
                                    }
                                  >
                                    {isWorking ? "…" : "+"}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {isPackage && !allDeposited && (
                        <div style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>
                          <button
                            className="btn-contribute"
                            disabled={isPackageWorking}
                            style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                            title="Verify all package items are in ephemeral, then deliver the entire package at once"
                            onClick={() => handleDeliveryPackageComplete(d.id)}
                          >
                            {isPackageWorking ? "Delivering…" : "📦 Deliver Package"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            );
          })()}

          {/* ── SSU owner: verify incoming deliveries via TX digest ── */}
          {(() => {
            const ownerAddr = ssuInventory?.ownerId?.toLowerCase() ?? "";
            const myCharAddr = character?.objectId?.toLowerCase() ?? "";
            const isOwner = ownerAddr && myCharAddr && ownerAddr === myCharAddr;
            if (!isOwner) return null;
            const ownerDeliveries = (incomingDeliveries ?? []).filter(
              (d) => d.status === "in-transit" && d.couriers.some((c) => c.status === "in-transit" && c.claimDigest),
            );
            if (ownerDeliveries.length === 0) return null;
            return (
              <>
                <h4 style={{ margin: "0.5rem 0 0.25rem", fontSize: "0.85rem", color: "var(--color-accent)" }}>
                  📦 Incoming Deliveries (verify)
                </h4>
                {ownerDeliveries.map((d) => {
                  const courier = d.couriers.find((c) => c.status === "in-transit" && c.claimDigest);
                  if (!courier) return null;
                  const isPackage = !!d.packageId;
                  const allVerified = d.items.every((item) => {
                    const dep = courier.itemsDeposited.find((x) => x.typeId === item.typeId);
                    return (dep?.quantity ?? 0) >= item.quantity;
                  });
                  const isPackageWorking = contributing === `package-verify-${d.id}`;
                  return (
                    <div key={d.id} className="goal-card" style={{ borderLeft: "3px solid var(--color-success, #4caf50)" }}>
                      <div className="goal-header">
                        <span className="goal-type">{isPackage ? "📦 Verify Package" : "📦 Verify Delivery"}</span>
                        <span className="goal-desc">
                          Courier: {courier.courierName || courier.courierWallet.slice(0, 10)}
                        </span>
                      </div>
                      <div className="rolodex-container">
                        {d.items.map((item, idx) => {
                          const deposited = courier.itemsDeposited.find(
                            (dep) => dep.typeId === item.typeId,
                          );
                          const depositedQty = deposited?.quantity ?? 0;
                          const remaining = item.quantity - depositedQty;
                          const isComplete = remaining <= 0;
                          const isWorking = contributing === `delivery-${d.id}-${item.typeId}`;
                          return (
                            <div
                              key={idx}
                              className={`rolodex-card phase-deliver-card${isComplete ? " mission-complete-card" : ""}`}
                            >
                              <div className="rc-header">
                                <span className="rc-phase phase-deliver">Verify</span>
                                <span className="rc-progress">
                                  {depositedQty}/{item.quantity}
                                </span>
                                {isComplete && <span className="rc-done-badge">DONE</span>}
                              </div>
                              <div className="rc-desc">
                                <MissionIcon typeId={item.typeId} phase="DELIVER" size={18} />
                                {item.itemName}
                              </div>
                              {!isPackage && (
                                <div className="rc-req">
                                  Verify courier's on-chain claim TX
                                </div>
                              )}
                              {!isPackage && !isComplete && (
                                <div className="rc-controls">
                                  <button
                                    className="btn-contribute"
                                    disabled={isWorking}
                                    title="Verify claim TX digest on-chain and complete delivery"
                                    onClick={() =>
                                      handleDeliveryComplete(d.id, {
                                        ...item,
                                        quantity: remaining,
                                      })
                                    }
                                  >
                                    {isWorking ? "…" : "✓"}
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                      {isPackage && !allVerified && (
                        <div style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>
                          <button
                            className="btn-contribute"
                            disabled={isPackageWorking}
                            style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                            title="Verify courier's claim TX and complete all package items at once"
                            onClick={() => handleVerifyPackageDelivery(d.id)}
                          >
                            {isPackageWorking ? "Verifying…" : "✓ Verify Package"}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            );
          })()}

          {publishedGoals.length === 0 && (
            <p className="muted">No goals published yet. Check back later.</p>
          )}

          {publishedGoals.map((goal) => {
            const isExpanded = expandedGoals.has(goal.id);
            const rewards = computeTieredRewards(
              goal.missions,
              goal.publishedMissions,
              goal.completed,
              goal.budget,
              goal.tierPercents,
              goal.acquireRewards,
            );

            // Only show published, non-alternative missions
            const visibleMissions = goal.missions
              .map((m, i) => ({ m, i }))
              .filter(({ i }) => goal.publishedMissions.has(i));

            return (
              <div key={goal.id} className="goal-card">
                <div
                  className="goal-header goal-header-clickable"
                  onClick={() => toggleExpand(goal.id)}
                >
                  <span className="goal-expand">{isExpanded ? "▼" : "▶"}</span>
                  <span className="goal-type">{GOAL_TYPE_LABELS[goal.type] ?? goal.type}</span>
                  <span className="goal-desc">{goal.description}</span>
                  {goal.ongoing && <span className="goal-ongoing-badge">ONGOING{(goal.cycleCount ?? 0) > 0 ? ` · Cycle ${goal.cycleCount}` : ""}</span>}
                  {goal.budget > 0 && (
                    <span className="goal-budget">{Math.max(0, goal.budget - (goal.budgetAwarded ?? 0)).toLocaleString()} / {goal.budget.toLocaleString()} {ticker}{goal.ongoing ? " / cycle" : ""}</span>
                  )}
                </div>

                {isExpanded && (() => {
                  // Check if this is a package-linked delivery goal
                  const goalDelivery = (outgoingDeliveries ?? []).find(
                    (d) => d.sourceType === "goal" && d.sourceId === String(goal.id),
                  );
                  const isPackageDelivery = !!goalDelivery?.packageId;
                  const hasDeliverMissions = goal.missions.some((m) => m.phase === "DELIVER");
                  const allDeliverDone = hasDeliverMissions && goal.missions
                    .filter((m) => m.phase === "DELIVER")
                    .every((m) => {
                      const idx = goal.missions.indexOf(m);
                      return (goal.completed.get(idx) ?? 0) >= m.quantity;
                    });
                  const isPackageClaiming = contributing === `package-${goal.id}`;
                  const deliveryInTransit = goalDelivery?.status === "in-transit";

                  return (
                  <>
                  <div className="rolodex-container">
                    {visibleMissions.map(({ m, i }) => {
                      const reward = rewards[i];
                      const done = goal.completed.get(i) ?? 0;
                      const remaining = m.quantity - done;
                      const isComplete = remaining <= 0;
                      const isContributing = contributing === `${goal.id}-${i}`;
                      const display = parseMissionDisplay(m);
                      const missionWingIds = goal.missionWings?.[i] ?? [];
                      const myWingTags = missionWingIds
                        .filter((wId) => userWingIds.includes(wId))
                        .map((wId) => wings.find((w) => w.id === wId))
                        .filter(Boolean);

                      // Delivery status: look up linked delivery for DELIVER missions
                      const linkedDelivery = m.phase === "DELIVER"
                        ? (outgoingDeliveries ?? []).find(
                            (d) => d.sourceType === "goal" && d.sourceId === String(goal.id),
                          )
                        : undefined;
                      const isDeliveryInTransit = linkedDelivery?.status === "in-transit";
                      const deliveryDeadline = linkedDelivery
                        ? linkedDelivery.createdAt + linkedDelivery.timerMs
                        : 0;

                      // Input materials for withdrawal button (REFINE, PRINT only)
                      const missionInputs = getMissionInputs(m);
                      const isWithdrawing = contributing === `withdraw-${goal.id}-${i}`;

                      return (
                        <div
                          key={i}
                          className={`rolodex-card phase-${m.phase.toLowerCase()}-card${isComplete ? " mission-complete-card" : ""}${m.isAlternative ? " mission-alt-card" : ""}`}
                        >
                          <div className="rc-header">
                            <span className={`rc-phase phase-${m.phase.toLowerCase()}`}>
                              {display.title}
                            </span>
                            {myWingTags.map((w) => (
                              <span key={w!.id} className="wing-tag" style={{ borderColor: w!.color, color: w!.color }}>{w!.name}</span>
                            ))}
                            <span className="rc-progress">
                              {done}/{m.quantity}
                            </span>
                            {reward > 0 && !isComplete && !isDeliveryInTransit && (
                              <span className="rc-reward">{reward.toLocaleString()} {ticker}</span>
                            )}
                            {isDeliveryInTransit && (
                              <span className="rc-ongoing-badge">
                                ONGOING · {formatCountdown(deliveryDeadline - Date.now())}
                              </span>
                            )}
                            {isComplete && <span className="rc-done-badge">DONE</span>}
                          </div>
                          <div className="rc-desc">
                            {display.inputTypeId != null ? (
                              <><MissionIcon typeId={display.inputTypeId} phase="GATHER" size={18} />{display.inputName} → <MissionIcon typeId={display.outputTypeId} phase="REFINE" size={18} />{display.outputName}</>
                            ) : (
                              <><MissionIcon typeId={m.typeId} phase={m.phase} size={18} />{display.desc}</>
                            )}
                          </div>
                          <div className="rc-req">
                            {isDeliveryInTransit
                              ? `In transit — ${linkedDelivery!.couriers.filter((c) => c.status === "in-transit").length} courier(s) active`
                              : display.requirement}
                          </div>
                          {!isComplete && !isDeliveryInTransit && !(isPackageDelivery && m.phase === "DELIVER") && (
                            <div className="rc-controls">
                              {missionInputs.length > 0 && (
                                <button
                                  className="btn-contribute"
                                  disabled={isWithdrawing}
                                  title={`Withdraw input materials (${missionInputs.map((inp) => inp.itemName).join(", ")})`}
                                  onClick={() => handleWithdrawOpen(goal.id, i, missionInputs[0], goal)}
                                  style={{ fontSize: "0.7rem" }}
                                >
                                  {isWithdrawing ? "…" : "🔽"}
                                </button>
                              )}
                              <button
                                className="btn-contribute"
                                disabled={isContributing}
                                title={m.phase === "DELIVER" ? "Take items for delivery" : "Deposit items to SSU and earn credits"}
                                onClick={() => handleContribute(goal.id, i, reward, m, done)}
                              >
                                {isContributing ? "…" : m.phase === "DELIVER" ? "📦" : "+"}
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  {/* Package pickup button — below the rolodex, bottom-right */}
                  {isPackageDelivery && hasDeliverMissions && !allDeliverDone && !deliveryInTransit && (
                    <div style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>
                      <button
                        className="btn-contribute"
                        disabled={isPackageClaiming}
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                        title="Pick up all package items at once"
                        onClick={() => handleDeliveryPackageClaim(goal.id)}
                      >
                        {isPackageClaiming ? "Picking up…" : "📦 Pick up Package"}
                      </button>
                    </div>
                  )}
                  </>
                  );
                })()}
              </div>
            );
          })}
          </>)}

          {opsTab === "contracts" && (
            <ContractsPanel
              contracts={contracts}
              wallet={account?.address ?? ""}
              playerName={character?.name ?? "Unknown"}
              ticker={ticker}
              tribeId={tribeId}
              ssuId={ssuId}
              vaultId={vaultId ?? null}
              walletCreditsAmount={Math.floor((walletCredits?.credits ?? 0) / 1e9)}
              character={character ?? null}
              ssuInventory={ssuInventory ?? null}
              queryClient={queryClient}
              onCancel={cancelContract}
              onAccept={acceptContract}
              onProgress={progressContractMission}
              onFail={failContract}
              onExpire={expireContract}
              onCreate={createContract}
            />
          )}
        </section>
      )}
    </>
  );
}

/* ─── Countdown helper ─── */
function formatCountdown(ms: number): string {
  if (ms <= 0) return "Expired";
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  return `${h}h ${m}m`;
}

/* ─── Contracts panel (inside Operations tab) ─── */

type GoalType = "Construct" | "Build" | "Assemble" | "Print" | "Refine" | "Gather" | "Acquire" | "Deliver";

function getItemsForType(type: GoalType): string[] {
  switch (type) {
    case "Construct": return getBuildings();
    case "Build": return getShips();
    case "Assemble": return getModules();
    case "Print": return getPrintItems();
    case "Refine": return getRefineItems();
    case "Gather": return getGatherItems();
    case "Acquire": return getAcquireItems();
    case "Deliver": return [];
  }
}

function durationMs(val: number, unit: "h" | "d" | "w"): number {
  return val * (unit === "h" ? 3_600_000 : unit === "d" ? 86_400_000 : 604_800_000);
}

function maxForUnit(unit: "h" | "d" | "w"): number {
  return unit === "h" ? 24 : unit === "d" ? 7 : 3;
}

function ContractsPanel({
  contracts,
  wallet,
  playerName,
  ticker,
  tribeId,
  ssuId,
  vaultId,
  walletCreditsAmount,
  onCancel,
  onAccept,
  onProgress,
  onFail,
  onExpire,
  onCreate,
  character: charProp,
  ssuInventory,
  queryClient,
}: {
  contracts: Contract[];
  wallet: string;
  playerName: string;
  ticker: string;
  tribeId: string;
  ssuId: string;
  vaultId: string | null;
  walletCreditsAmount: number;
  onCancel: (id: string) => Promise<void>;
  onAccept: (id: string, wallet: string, name: string, deposit: number) => Promise<void>;
  onProgress: (id: string, idx: number, qty: number, typeId?: number, itemName?: string) => Promise<void>;
  onFail: (id: string) => Promise<void>;
  onExpire: (id: string) => Promise<void>;
  character: import("../hooks/useCharacter").CharacterData | null;
  ssuInventory: ReturnType<typeof useSsuInventory>["data"] | null;
  queryClient: ReturnType<typeof useQueryClient>;
  onCreate: (data: {
    id: string; type: string; description: string; budget: number; taxPaid: number;
    visibility: string; postDurationMs: number; missionDurationMs: number;
    creatorWallet: string; creatorName: string; missions: import("../data/supplyChain").Mission[];
    fromOnChain?: number;
    deliveryItems?: DeliveryItem[];
    destinationSsuId?: string;
    destinationTribeId?: string;
    destinationLabel?: string;
    collateral?: number;
    packageId?: string;
  }) => Promise<void>;
}) {
  useRecipes(); // ensure custom recipes loaded (parity with goal creation in OperationsTab)

  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [acting, setActing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contractContribError, setContractContribError] = useState<string | null>(null);
  const now = Date.now();

  // On-chain transfer hooks for contract mission progression
  const { escrow: escrowToOpenInner } = useEscrowFromEphemeral(ssuId || undefined);
  const { trade: onChainTrade } = useTrade(ssuId || undefined);
  const { releaseBatch: onChainReleaseBatchCp } = useReleaseBatch(ssuId || undefined);
  const { pickupBatch: onChainPickupBatchCp } = usePickupBatch(ssuId || undefined);
  const { claimDelivery: claimDeliveryCp } = useDeliveryActions(ssuId || "", tribeId || "");
  const { items: corpItemsCp, releaseFromCorpStorage: releaseFromCorpStorageCp } = useCorporateInventory(ssuId || "", tribeId || "");

  /**
   * Handle Deliver contract claim: pick up items at the source SSU.
   * Checks main storage first, falls back to corporate (open) storage.
   * For non-owners: release open→main then claim main→ephemeral.
   * For owners: release open→main (items stay accessible).
   */
  async function handleContractDeliveryClaim(c: Contract, m: import("../context/ContractContext").ContractMission) {
    setContractContribError(null);
    try {
      if (!ssuInventory) {
        setContractContribError("SSU inventory not loaded yet. Click ↻ Refresh and try again.");
        return;
      }
      if (!charProp?.objectId || !charProp?.ownerCapId) {
        setContractContribError("Character data not loaded. Please reconnect your wallet.");
        return;
      }
      if (!c.delivery?.id) {
        setContractContribError("No linked delivery record found for this contract.");
        return;
      }

      const remaining = m.quantity - m.completedQty;
      if (remaining <= 0) return;

      const itemName = extractItemName(m.description);
      const myCharAddr = charProp.objectId?.toLowerCase() ?? '';
      const ssuOwnerAddr = ssuInventory.ownerId?.toLowerCase() ?? '';
      const isSsuOwner = myCharAddr && ssuOwnerAddr && myCharAddr === ssuOwnerAddr;

      // Check main storage first
      let mainAvailable = findItemQuantity(ssuInventory.mainItems, m.typeId ?? undefined, itemName);
      let releasedFromCorp = false;

      // Fall back to corporate (open) storage if not in main
      let fromCorp = 0;
      if (mainAvailable <= 0 && m.typeId && m.typeId > 0) {
        const openAvailable = findItemQuantity(ssuInventory.openStorageItems ?? [], m.typeId, itemName);
        const corpEntry = corpItemsCp?.find((ci: any) => ci.typeId === m.typeId);
        if (openAvailable > 0 || (corpEntry && corpEntry.quantity > 0)) {
          fromCorp = Math.min(openAvailable, remaining);
          if (fromCorp > 0) {
            mainAvailable = fromCorp;
            releasedFromCorp = true;
          }
        }
      }

      if (mainAvailable <= 0) {
        const what = itemName ?? `type #${m.typeId}`;
        setContractContribError(`"${what}" not found in SSU storage. Nothing to pick up.`);
        return;
      }

      const claimQty = Math.min(mainAvailable, remaining);

      let claimDigest: string | null = null;
      if (!isSsuOwner && m.typeId && m.typeId > 0) {
        // Single PTB: release corporate (open→main) + claim (main→ephemeral)
        const releaseItems = fromCorp > 0 ? [{ typeId: m.typeId, quantity: fromCorp }] : [];
        const claimItems = [{ typeId: m.typeId, quantity: claimQty }];
        try {
          claimDigest = await onChainPickupBatchCp(
            charProp.objectId,
            charProp.ownerCapId,
            releaseItems, claimItems,
          );
          if (!claimDigest) {
            setContractContribError("On-chain pickup failed. Please try again.");
            return;
          }
          if (releasedFromCorp) {
            const corpEntry = corpItemsCp?.find((ci: any) => ci.typeId === m.typeId);
            if (corpEntry) await releaseFromCorpStorageCp(m.typeId, itemName ?? `type-${m.typeId}`, fromCorp);
          }
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
        } catch (e) {
          console.error("[contract-delivery-claim] Pickup error:", e);
          setContractContribError(`Pickup failed: ${(e as Error).message}`);
          return;
        }
      } else if (isSsuOwner && releasedFromCorp && m.typeId && m.typeId > 0) {
        // Owner: just release corporate items to main
        try {
          const ok = await onChainReleaseBatchCp(
            charProp.objectId, charProp.ownerCapId,
            [{ typeId: m.typeId, quantity: fromCorp }],
          );
          if (ok) {
            const corpEntry = corpItemsCp?.find((ci: any) => ci.typeId === m.typeId);
            if (corpEntry) await releaseFromCorpStorageCp(m.typeId, itemName ?? `type-${m.typeId}`, fromCorp);
          }
        } catch (e) {
          console.warn("[contract-delivery-claim] Owner release error:", e);
        }
      }

      // Save claim digest on courier record
      const digest = claimDigest ?? (isSsuOwner ? "owner-claim" : null);
      if (digest) {
        try {
          await claimDeliveryCp(c.delivery.id, wallet, digest);
        } catch (e) {
          console.warn("[contract-delivery-claim] Failed to save claim digest:", e);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["contracts"] });
      if (releasedFromCorp) queryClient.invalidateQueries({ queryKey: ["corporate-inventory"] });
      setContractContribError(null);
    } catch (err) {
      console.error("[handleContractDeliveryClaim] error:", err);
      setContractContribError(`Error: ${(err as Error).message || "Unknown error"}`);
    }
  }

  /**
   * Handle Deliver contract batch claim: pick up ALL package items at once.
   * For non-owners: batch release open→main then batch claim main→ephemeral.
   */
  async function handleContractPackageClaim(c: Contract) {
    setContractContribError(null);
    try {
      if (!ssuInventory) {
        setContractContribError("SSU inventory not loaded yet. Click ↻ Refresh and try again.");
        return;
      }
      if (!charProp?.objectId || !charProp?.ownerCapId) {
        setContractContribError("Character data not loaded. Please reconnect your wallet.");
        return;
      }
      if (!c.delivery?.id) {
        setContractContribError("No linked delivery record found for this contract.");
        return;
      }

      const myCharAddr = charProp.objectId?.toLowerCase() ?? '';
      const ssuOwnerAddr = ssuInventory.ownerId?.toLowerCase() ?? '';
      const isSsuOwner = myCharAddr && ssuOwnerAddr && myCharAddr === ssuOwnerAddr;

      // Collect all delivery items and figure out where each lives
      const toRelease: { typeId: number; quantity: number }[] = [];
      const toClaim: { typeId: number; quantity: number }[] = [];
      const corpReleases: { typeId: number; itemName: string; quantity: number }[] = [];

      for (const m of c.missions) {
        if (m.phase !== "DELIVER") continue;
        const remaining = m.quantity - m.completedQty;
        if (remaining <= 0 || !m.typeId || m.typeId <= 0) continue;

        const itemName = extractItemName(m.description);
        let mainQty = findItemQuantity(ssuInventory.mainItems, m.typeId, itemName);

        // Check corporate/open storage if not enough in main
        if (mainQty < remaining) {
          const openQty = findItemQuantity(ssuInventory.openStorageItems ?? [], m.typeId, itemName);
          const corpEntry = corpItemsCp?.find((ci: any) => ci.typeId === m.typeId);
          const releaseQty = Math.min(openQty, remaining - mainQty);
          if (releaseQty > 0) {
            toRelease.push({ typeId: m.typeId, quantity: releaseQty });
            if (corpEntry) {
              corpReleases.push({ typeId: m.typeId, itemName: itemName ?? `type-${m.typeId}`, quantity: releaseQty });
            }
            mainQty += releaseQty;
          }
        }

        const claimQty = Math.min(mainQty, remaining);
        if (claimQty > 0) {
          toClaim.push({ typeId: m.typeId, quantity: claimQty });
        }
      }

      if (toClaim.length === 0) {
        setContractContribError("No items available to pick up in SSU storage.");
        return;
      }

      // Single PTB: release corporate (open→main) + claim all (main→ephemeral)
      let claimDigest: string | null = null;
      if (!isSsuOwner) {
        try {
          claimDigest = await onChainPickupBatchCp(
            charProp.objectId,
            charProp.ownerCapId,
            toRelease, toClaim,
          );
          if (!claimDigest) {
            setContractContribError("On-chain package pickup failed. Please try again.");
            return;
          }
          for (const cr of corpReleases) {
            await releaseFromCorpStorageCp(cr.typeId, cr.itemName, cr.quantity);
          }
          setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
        } catch (e) {
          console.error("[contract-package-claim] Pickup error:", e);
          setContractContribError(`Package pickup failed: ${(e as Error).message}`);
          return;
        }
      } else if (toRelease.length > 0) {
        // SSU owner: release corporate to main
        try {
          const ok = await onChainReleaseBatchCp(
            charProp.objectId, charProp.ownerCapId, toRelease,
          );
          if (ok) {
            for (const cr of corpReleases) {
              await releaseFromCorpStorageCp(cr.typeId, cr.itemName, cr.quantity);
            }
          }
        } catch (e) {
          console.warn("[contract-package-claim] Owner release error:", e);
        }
      }

      // Save claim digest on courier record
      const digest = claimDigest ?? (isSsuOwner ? "owner-claim" : null);
      if (digest) {
        try {
          await claimDeliveryCp(c.delivery.id, wallet, digest);
        } catch (e) {
          console.warn("[contract-package-claim] Failed to save claim digest:", e);
        }
      }

      queryClient.invalidateQueries({ queryKey: ["contracts"] });
      if (toRelease.length > 0) queryClient.invalidateQueries({ queryKey: ["corporate-inventory"] });
      setContractContribError(null);
    } catch (err) {
      console.error("[handleContractPackageClaim] error:", err);
      setContractContribError(`Error: ${(err as Error).message || "Unknown error"}`);
    }
  }

  /**
   * Handle contract mission progression with inventory verification + on-chain transfer.
   * Mirrors the goal `handleContribute` flow:
   *  1. Check ephemeral inventory for deposited items
   *  2. Determine transfer path: trade (ephemeral→creator ephemeral) or contribute (ephemeral→main)
   *  3. Execute on-chain transfer
   *  4. Record off-chain progress
   */
  async function handleContractProgress(c: Contract, m: import("../context/ContractContext").ContractMission) {
    setContractContribError(null);
    try {
      if (!ssuInventory) {
        setContractContribError("SSU inventory not loaded yet. Click ↻ Refresh and try again.");
        return;
      }
      if (!charProp?.objectId || !charProp?.ownerCapId) {
        setContractContribError("Character data not loaded. Please reconnect your wallet.");
        return;
      }

      const remaining = m.quantity - m.completedQty;
      if (remaining <= 0) return;

      // Find the user's ephemeral inventory
      const myOwnerCapId = charProp.ownerCapId;
      let userEphemeral = myOwnerCapId
        ? ssuInventory.ephemeralByOwner.get(myOwnerCapId.toLowerCase())
        : undefined;
      if (!userEphemeral || userEphemeral.length === 0) {
        userEphemeral = ssuInventory.allEphemeral;
      }

      const itemName = extractItemName(m.description);
      const deposited = findItemQuantity(userEphemeral, m.typeId ?? undefined, itemName);
      if (deposited <= 0) {
        const what = itemName ?? `type #${m.typeId}`;
        setContractContribError(
          `"${what}" not found in your ephemeral storage. Deposit items to the SSU first.`
        );
        return;
      }

      const progressAmt = Math.min(deposited, remaining);
      if (progressAmt <= 0) return;

      // Determine transfer path: is the creator the SSU owner?
      const creatorIsOwner = c.creatorWallet.toLowerCase() === (ssuInventory.ownerId?.toLowerCase() ?? "");

      if (m.typeId && m.typeId > 0) {
        if (creatorIsOwner) {
          // Creator is SSU owner — ephemeral → open storage (corp, hidden from game UI)
          try {
            const ok = await escrowToOpenInner(
              charProp.objectId,
              charProp.ownerCapId,
              m.typeId,
              progressAmt,
            );
            if (ok) {
              setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
            } else {
              console.warn("[contract progress] On-chain escrow failed. Proceeding off-chain.");
            }
          } catch (e) {
            console.warn("[contract progress] On-chain escrow error:", e);
          }
        } else {
          // Creator is NOT SSU owner → ephemeral → creator's ephemeral (trade)
          try {
            const creatorChar = await fetchCharacter(c.creatorWallet);
            if (creatorChar) {
              const ok = await onChainTrade(
                charProp.objectId,
                charProp.ownerCapId,
                creatorChar.objectId,
                m.typeId,
                progressAmt,
              );
              if (ok) {
                setTimeout(() => queryClient.invalidateQueries({ queryKey: ["ssu-inventory"] }), 2000);
              } else {
                console.warn("[contract progress] On-chain trade failed. Proceeding off-chain.");
              }
            } else {
              console.warn("[contract progress] Could not resolve creator character. Proceeding off-chain.");
            }
          } catch (e) {
            console.warn("[contract progress] On-chain trade error:", e);
          }
        }
      }

      // Record off-chain progress + escrow
      await onProgress(c.id, m.idx, progressAmt, m.typeId ?? undefined, m.description);
      setContractContribError(null);
    } catch (err) {
      console.error("[handleContractProgress] error:", err);
      setContractContribError(`Error: ${(err as Error).message || "Unknown error"}`);
    }
  }

  /** Derive ticker from a contract's creatorCoinType, falling back to the viewing tribe's ticker */
  const cTicker = (c: Contract) => {
    if (!c.creatorCoinType) return ticker;
    const parts = c.creatorCoinType.split("::");
    return parts.length >= 3 ? parts[2] : ticker;
  };

  // --- Create Contract modal state ---
  const [showModal, setShowModal] = useState(false);
  const [cType, setCType] = useState<GoalType>("Construct");
  const [cItem, setCItem] = useState("");
  const [cAmount, setCAmount] = useState(1);
  const [cBudget, setCBudget] = useState(0);
  const [cVisibility, setCVisibility] = useState<"tribe" | "public">("tribe");
  const [cPostUnit, setCPostUnit] = useState<"h" | "d" | "w">("d");
  const [cPostVal, setCPostVal] = useState(1);
  const [cMissionUnit, setCMissionUnit] = useState<"h" | "d" | "w">("d");
  const [cMissionVal, setCMissionVal] = useState(1);
  const [cError, setCError] = useState<string | null>(null);
  const [cCreating, setCCreating] = useState(false);
  const { taxBps } = useTribeTax(tribeId);
  const { data: offChainBal } = useOffChainBalance(tribeId, wallet || undefined);
  const { redeem, pending: redeemPending } = useRedeem(vaultId);

  // ── Delivery-specific state ──
  const { ssus: territorySSUs } = useTerritoryData(tribeId, wallet, ssuId);
  const { data: deliverySsuInventory } = useSsuInventory(ssuId || undefined);
  const { createDelivery: _createDelivery } = useDeliveryActions(ssuId, tribeId);
  const [deliveryDestSsu, setDeliveryDestSsu] = useState("");
  const [deliveryItems, setDeliveryItems] = useState<DeliveryItem[]>([]);
  const [deliveryCollateral, setDeliveryCollateral] = useState(0);
  const [deliveryTimerUnit, setDeliveryTimerUnit] = useState<"h" | "d" | "w">("d");
  const [deliveryTimerVal, setDeliveryTimerVal] = useState(1);
  const [cDeliveryMode, setCDeliveryMode] = useState<"items" | "package">("items");
  const [cSelectedPackageId, setCSelectedPackageId] = useState("");
  const { packages: cAvailablePackages } = usePackages(ssuId, tribeId);

  const destinationOptions = territorySSUs.filter((s) => s.ssuId !== ssuId && s.locationGranted);
  const allOtherSsuIds = useMemo(() => territorySSUs.filter((s) => s.ssuId !== ssuId).map((s) => s.ssuId), [territorySSUs, ssuId]);
  const { data: onChainNames } = useSsuOnChainNames(allOtherSsuIds);

  // Lookup: ssuId → current display name (for re-resolving stale labels)
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
  const availableItems = (deliverySsuInventory?.mainItems ?? []).map((it: any) => ({
    typeId: Number(it.type_id ?? it.typeId ?? 0),
    name: String(it.name || `Item #${it.type_id ?? it.typeId ?? 0}`),
    qty: Number(it.quantity ?? it.qty ?? 0),
  })).filter((it: any) => it.qty > 0);

  function addDeliveryItem() {
    const first = availableItems.find((ai: any) => !deliveryItems.some((di) => di.typeId === ai.typeId));
    if (first) setDeliveryItems((prev) => [...prev, { typeId: first.typeId, itemName: first.name, quantity: 1 }]);
  }
  function removeDeliveryItem(idx: number) {
    setDeliveryItems((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateDeliveryItem(idx: number, field: keyof DeliveryItem, val: any) {
    setDeliveryItems((prev) => prev.map((it, i) => i === idx ? { ...it, [field]: val } : it));
  }

  // Packages available for delivery (created or allocated, not listed/sold/cancelled)
  const cDeliverablePackages = cAvailablePackages.filter(
    (p) => p.status === "created" || p.status === "allocated",
  );

  function cSelectPackageForDelivery(pkgId: string) {
    setCSelectedPackageId(pkgId);
    const pkg = cDeliverablePackages.find((p) => p.id === pkgId);
    if (pkg) {
      setDeliveryItems(pkg.items.map((pi) => ({
        typeId: pi.itemTypeId,
        itemName: pi.itemName,
        quantity: pi.quantity,
      })));
    } else {
      setDeliveryItems([]);
    }
  }

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

  async function handleCreateContract() {
    setCError(null);

    // ── Deliver contracts have a separate flow ──
    if (cType === "Deliver") {
      if (!deliveryDestSsu) { setCError("Select a destination SSU"); return; }
      if (deliveryItems.length === 0) { setCError("Add at least one item to deliver"); return; }
      if (cBudget <= 0) { setCError("Budget must be > 0"); return; }

      const tax = calcTribeTax(cBudget, taxBps);
      const total = cBudget + tax;
      const earned = offChainBal ?? 0;
      const onChain = walletCreditsAmount;
      const combined = earned + onChain;
      if (total > combined) { setCError(`Insufficient balance. Need ${total.toLocaleString()} ${ticker} but have ${combined.toLocaleString()}`); return; }

      const offChainPortion = Math.min(earned, total);
      const onChainPortion = total - offChainPortion;
      if (onChainPortion > 0) {
        const ok = await redeem(onChainPortion);
        if (!ok) { setCError("On-chain redemption failed — contract not created"); return; }
      }

      const destLabel = ssuNameLookup.get(deliveryDestSsu) ?? deliveryDestSsu.slice(0, 10);
      const selectedPkg = cDeliveryMode === "package" ? cDeliverablePackages.find((p) => p.id === cSelectedPackageId) : undefined;
      const itemsDesc = deliveryItems.map((it) => `${it.quantity}× ${it.itemName}`).join(", ");

      // Deliver contracts use a single mission per item
      const missions = deliveryItems.map((it, idx) => ({
        idx,
        phase: "DELIVER" as const,
        tier: 1,
        description: it.itemName,
        quantity: it.quantity,
        completedQty: 0,
        typeId: it.typeId,
        isAlternative: false,
      }));

      setCCreating(true);
      try {
        await onCreate({
          id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          type: "Deliver",
          description: selectedPkg
            ? `📦 ${selectedPkg.name} → ${destLabel}`
            : `📦 ${itemsDesc} → ${destLabel}`,
          budget: cBudget,
          taxPaid: tax,
          visibility: cVisibility,
          postDurationMs: durationMs(cPostVal, cPostUnit),
          missionDurationMs: durationMs(deliveryTimerVal, deliveryTimerUnit),
          creatorWallet: wallet,
          creatorName: playerName,
          missions,
          fromOnChain: onChainPortion,
          deliveryItems,
          destinationSsuId: deliveryDestSsu,
          destinationTribeId: tribeId,
          destinationLabel: destLabel,
          collateral: deliveryCollateral,
          packageId: selectedPkg?.id,
        });
        setShowModal(false);
        setCBudget(0);
        setDeliveryItems([]);
        setDeliveryDestSsu("");
        setDeliveryCollateral(0);
        setCSelectedPackageId("");
        setCDeliveryMode("items");
      } catch (e) {
        setCError((e as Error).message);
      } finally {
        setCCreating(false);
      }
      return;
    }

    // ── Standard contract flow ──
    const itemName = cItem || getItemsForType(cType)[0];
    if (!itemName) { setCError("Select an item"); return; }
    if (cBudget <= 0) { setCError("Budget must be > 0"); return; }
    const tax = calcTribeTax(cBudget, taxBps);
    const total = cBudget + tax;
    const earned = offChainBal ?? 0;
    const onChain = walletCreditsAmount;
    const combined = earned + onChain;
    if (total > combined) { setCError(`Insufficient balance. Need ${total.toLocaleString()} ${ticker} but have ${combined.toLocaleString()} (${earned.toLocaleString()} earned + ${onChain.toLocaleString()} wallet)`); return; }

    // Calculate split: off-chain first, remainder from on-chain
    const offChainPortion = Math.min(earned, total);
    const onChainPortion = total - offChainPortion;

    // If on-chain spending required, redeem those credits first (requires wallet signature)
    if (onChainPortion > 0) {
      const ok = await redeem(onChainPortion);
      if (!ok) { setCError("On-chain redemption failed — contract not created"); return; }
    }

    let missions: import("../data/supplyChain").Mission[];
    switch (cType) {
      case "Construct": missions = decomposeConstruct(itemName, cAmount, structureFilter); break;
      case "Build":     missions = decomposeBuild(itemName, cAmount, structureFilter); break;
      case "Assemble":  missions = decomposeAssemble(itemName, cAmount, structureFilter); break;
      case "Print":     missions = decomposePrint(itemName, cAmount, structureFilter); break;
      case "Refine":    missions = decomposeRefine(itemName, cAmount, structureFilter); break;
      case "Gather":    missions = decomposeGather(itemName, cAmount); break;
      case "Acquire":   missions = decomposeAcquire(itemName, cAmount); break;
      default:          missions = []; break;
    }
    if (missions.length === 0) { setCError("No missions generated for this item"); return; }

    setCCreating(true);
    try {
      await onCreate({
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: cType,
        description: `${cAmount}× ${itemName}`,
        budget: cBudget,
        taxPaid: tax,
        visibility: cVisibility,
        postDurationMs: durationMs(cPostVal, cPostUnit),
        missionDurationMs: durationMs(cMissionVal, cMissionUnit),
        creatorWallet: wallet,
        creatorName: playerName,
        missions,
        fromOnChain: onChainPortion,
      });
      setShowModal(false);
      setCBudget(0);
      setCAmount(1);
    } catch (e) {
      setCError((e as Error).message);
    } finally {
      setCCreating(false);
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Auto-expire / auto-fail contracts whose timers have elapsed
  useEffect(() => {
    for (const c of contracts) {
      if (c.status === "open") {
        const expiresAt = c.createdAt + c.postDurationMs;
        if (Date.now() >= expiresAt) onExpire(c.id).catch(() => {});
      }
      if (c.status === "accepted" && c.acceptedAt) {
        const deadline = c.acceptedAt + c.missionDurationMs;
        if (Date.now() >= deadline) onFail(c.id).catch(() => {});
      }
    }
  }, [contracts, onExpire, onFail]);

  const active = contracts.filter((c) => c.status === "open" || c.status === "accepted");
  const past = contracts.filter((c) => c.status !== "open" && c.status !== "accepted");

  async function act(fn: () => Promise<void>, label: string) {
    setActing(label);
    setError(null);
    try { await fn(); } catch (e) { setError((e as Error).message); }
    finally { setActing(null); }
  }

  return (
    <div className="contracts-panel">
      <div className="panel-header-row" style={{ marginBottom: "0.5rem" }}>
        <span />
        <button className="btn-primary" onClick={() => setShowModal(true)}>Create Contract</button>
      </div>

      {/* ── Create Contract Modal ── */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Create Contract</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>✕</button>
            </div>
            <div className="create-goal-form">
              <div className="input-row">
                <Select
                  value={cType}
                  onChange={(v) => { const t = v as GoalType; setCType(t); setCItem(getItemsForType(t)[0] ?? ""); }}
                  options={Object.entries(GOAL_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
                />
                {cType !== "Deliver" && (
                  <>
                <Select
                  value={cItem || (getItemsForType(cType)[0] ?? "")}
                  onChange={setCItem}
                  options={getItemsForType(cType).map((it) => ({ value: it, label: it }))}
                  style={{ flex: 1 }}
                />
                <input
                  type="number" min={1} max={10000} value={cAmount}
                  onChange={(e) => setCAmount(Math.max(1, Number(e.target.value) || 1))}
                  style={{ width: "5rem", textAlign: "center" }}
                  title="Desired amount"
                />
                  </>
                )}
              </div>

              {/* ── Deliver-specific form ── */}
              {cType === "Deliver" && (
                <div style={{ marginTop: "0.5rem" }}>
                  <div className="input-row">
                    <label style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>Destination:</label>
                    <Select
                      value={deliveryDestSsu}
                      onChange={setDeliveryDestSsu}
                      options={[
                        { value: "", label: "— Select destination SSU —" },
                        ...destinationOptions.map((s) => ({
                          value: s.ssuId,
                          label: ssuNameLookup.get(s.ssuId) ?? ssuDisplayName(s),
                        })),
                      ]}
                      style={{ flex: 1 }}
                    />
                  </div>

                  {/* Mode toggle: individual items vs package */}
                  <div className="input-row" style={{ marginTop: "0.5rem", gap: "0.3rem" }}>
                    <button
                      className={`side-btn${cDeliveryMode === "items" ? " active" : ""}`}
                      onClick={() => { setCDeliveryMode("items"); setCSelectedPackageId(""); setDeliveryItems([]); }}
                      style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}
                    >
                      Individual Items
                    </button>
                    <button
                      className={`side-btn${cDeliveryMode === "package" ? " active" : ""}`}
                      onClick={() => { setCDeliveryMode("package"); setDeliveryItems([]); }}
                      style={{ fontSize: "0.75rem", padding: "0.2rem 0.6rem" }}
                      disabled={cDeliverablePackages.length === 0}
                      title={cDeliverablePackages.length === 0 ? "No packages available — create one in Packaging tab" : ""}
                    >
                      📦 Package
                    </button>
                  </div>

                  {cDeliveryMode === "package" && (
                    <div style={{ marginTop: "0.5rem" }}>
                      <div className="input-row">
                        <label style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>Package:</label>
                        <Select
                          value={cSelectedPackageId}
                          onChange={cSelectPackageForDelivery}
                          options={[
                            { value: "", label: "— Select package —" },
                            ...cDeliverablePackages.map((p) => ({
                              value: p.id,
                              label: `${p.name}${p.shipType ? ` (${p.shipType})` : ""} — ${p.items.length} items`,
                            })),
                          ]}
                          style={{ flex: 1 }}
                        />
                      </div>
                      {cSelectedPackageId && (
                        <div style={{ marginTop: "0.3rem", fontSize: "0.75rem", color: "var(--color-text-muted)", padding: "0.3rem 0.5rem", border: "1px solid var(--color-border)", borderRadius: "4px" }}>
                          <div style={{ fontWeight: 600, marginBottom: "0.2rem" }}>📋 Package manifest:</div>
                          {deliveryItems.map((item, idx) => (
                            <div key={idx}>{item.quantity}× {item.itemName}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {cDeliveryMode === "items" && (
                  <div style={{ marginTop: "0.5rem" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <label style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Items to deliver:</label>
                      <button className="btn-subtle" onClick={addDeliveryItem} disabled={availableItems.length === 0}>+ Add item</button>
                    </div>
                    {deliveryItems.map((di, idx) => (
                      <div key={idx} className="input-row" style={{ marginTop: "0.3rem" }}>
                        <Select
                          value={String(di.typeId)}
                          onChange={(v) => {
                            const ai = availableItems.find((a: any) => String(a.typeId) === v);
                            if (ai) updateDeliveryItem(idx, "typeId", ai.typeId);
                            if (ai) updateDeliveryItem(idx, "itemName", ai.name);
                          }}
                          options={availableItems.map((a: any) => ({ value: String(a.typeId), label: a.name }))}
                          style={{ flex: 1 }}
                        />
                        <input
                          type="number" min={1}
                          max={availableItems.find((a: any) => a.typeId === di.typeId)?.qty ?? 9999}
                          value={di.quantity}
                          onChange={(e) => updateDeliveryItem(idx, "quantity", Math.max(1, Number(e.target.value) || 1))}
                          style={{ width: "4rem", textAlign: "center" }}
                        />
                        <button className="btn-subtle" onClick={() => removeDeliveryItem(idx)} style={{ color: "var(--color-error)" }}>✕</button>
                      </div>
                    ))}
                    {deliveryItems.length === 0 && <p className="muted" style={{ fontSize: "0.72rem" }}>No items added yet.</p>}
                  </div>
                  )}

                  <div className="input-row" style={{ marginTop: "0.5rem" }}>
                    <label style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>Collateral ({ticker}):</label>
                    <input
                      type="number" min={0} value={deliveryCollateral || ""}
                      onChange={(e) => setDeliveryCollateral(Number(e.target.value) || 0)}
                      placeholder="0 (optional)"
                      style={{ width: "6rem" }}
                    />
                    <span className="muted" style={{ fontSize: "0.72rem" }}>Courier must deposit to accept</span>
                  </div>

                  <div className="input-row" style={{ marginTop: "0.5rem" }}>
                    <label style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>Delivery time:</label>
                    <input type="number" min={1} max={maxForUnit(deliveryTimerUnit)} value={deliveryTimerVal} onChange={(e) => setDeliveryTimerVal(Math.max(1, Math.min(maxForUnit(deliveryTimerUnit), Number(e.target.value) || 1)))} style={{ width: "3rem", textAlign: "center" }} />
                    <Select value={deliveryTimerUnit} onChange={(v) => { setDeliveryTimerUnit(v as "h"|"d"|"w"); setDeliveryTimerVal(1); }} options={[{ value: "h", label: "hours" }, { value: "d", label: "days" }, { value: "w", label: "weeks" }]} />
                  </div>
                </div>
              )}

              {/* Structure filter checkboxes */}
              {(cType === "Construct" || cType === "Build" || cType === "Assemble" || cType === "Print" || cType === "Refine") && (
                <div className="structure-filter" style={{ marginTop: "0.5rem" }}>
                  {(cType === "Construct" || cType === "Build" || cType === "Assemble" || cType === "Print") && availablePrinters.length > 0 && (
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
                  {cType === "Build" && availableBerths.length > 0 && (
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
                  {(cType === "Build" || cType === "Assemble") && availableAssemblers.length > 0 && (
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
                  type="number" min={1} value={cBudget || ""}
                  onChange={(e) => { setCBudget(Number(e.target.value) || 0); setCError(null); }}
                  placeholder="0"
                />
                {cBudget > 0 && (
                  <span className="muted" style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>
                    + {calcTribeTax(cBudget, taxBps).toLocaleString()} tax ({(taxBps / 100).toFixed(1)}%)
                    = {(cBudget + calcTribeTax(cBudget, taxBps)).toLocaleString()} total
                  </span>
                )}
              </div>
              {/* Balance breakdown */}
              <div style={{ fontSize: "0.72rem", color: "var(--color-text-muted)", marginTop: "0.35rem", display: "flex", gap: "1rem", flexWrap: "wrap" }}>
                <span>Earned: <strong style={{ color: "var(--color-text)" }}>{(offChainBal ?? 0).toLocaleString()}</strong></span>
                <span>Wallet: <strong style={{ color: "var(--color-text)" }}>{walletCreditsAmount.toLocaleString()}</strong></span>
                <span>Total: <strong style={{ color: "var(--color-text)" }}>{((offChainBal ?? 0) + walletCreditsAmount).toLocaleString()}</strong> {ticker}</span>
              </div>
              {/* Gas fee warning when on-chain credits will be spent */}
              {cBudget > 0 && (() => {
                const tax = calcTribeTax(cBudget, taxBps);
                const total = cBudget + tax;
                const earned = offChainBal ?? 0;
                const onChainNeeded = Math.max(0, total - earned);
                if (onChainNeeded > 0 && onChainNeeded <= walletCreditsAmount) {
                  return (
                    <div style={{ fontSize: "0.72rem", color: "var(--color-accent)", marginTop: "0.25rem", padding: "0.3rem 0.5rem", border: "1px solid var(--color-accent)", background: "rgba(255,102,0,0.08)" }}>
                      ⚠ {onChainNeeded.toLocaleString()} {ticker} will be redeemed from your wallet (gas fees apply).
                      Earned credits: {Math.min(earned, total).toLocaleString()} | Wallet: {onChainNeeded.toLocaleString()}
                    </div>
                  );
                }
                return null;
              })()}
              <div className="input-row" style={{ marginTop: "0.5rem", gap: "1rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <label style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>Post for:</label>
                  <input type="number" min={1} max={maxForUnit(cPostUnit)} value={cPostVal} onChange={(e) => setCPostVal(Math.max(1, Math.min(maxForUnit(cPostUnit), Number(e.target.value) || 1)))} style={{ width: "3rem", textAlign: "center" }} />
                  <Select value={cPostUnit} onChange={(v) => { setCPostUnit(v as "h"|"d"|"w"); setCPostVal(1); }} options={[{ value: "h", label: "hours" }, { value: "d", label: "days" }, { value: "w", label: "weeks" }]} />
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
                  <label style={{ fontSize: "0.8rem", color: "var(--color-text-muted)", whiteSpace: "nowrap" }}>Mission time:</label>
                  <input type="number" min={1} max={maxForUnit(cMissionUnit)} value={cMissionVal} onChange={(e) => setCMissionVal(Math.max(1, Math.min(maxForUnit(cMissionUnit), Number(e.target.value) || 1)))} style={{ width: "3rem", textAlign: "center" }} />
                  <Select value={cMissionUnit} onChange={(v) => { setCMissionUnit(v as "h"|"d"|"w"); setCMissionVal(1); }} options={[{ value: "h", label: "hours" }, { value: "d", label: "days" }, { value: "w", label: "weeks" }]} />
                </div>
              </div>
              <div className="input-row" style={{ marginTop: "0.5rem" }}>
                <label style={{ fontSize: "0.8rem", color: "var(--color-text-muted)" }}>Visibility:</label>
                <Select value={cVisibility} onChange={(v) => setCVisibility(v as "tribe"|"public")} options={[{ value: "tribe", label: "Corporation only" }, { value: "public", label: "Public" }]} />
                <button className="btn-primary" onClick={handleCreateContract} disabled={cCreating || redeemPending} style={{ marginLeft: "auto" }}>
                  {redeemPending ? "Redeeming…" : cCreating ? "Creating…" : "Post Contract"}
                </button>
              </div>
              {cError && <p className="error">{cError}</p>}
            </div>
          </div>
        </div>
      )}
      {error && <p className="error" style={{ marginBottom: "0.5rem" }}>{error}</p>}
      {contractContribError && <p className="error" style={{ marginBottom: "0.5rem" }}>{contractContribError}</p>}

      {active.length === 0 && past.length === 0 && (
        <p className="muted">No contracts yet. Click "Create Contract" to post a bounty.</p>
      )}

      {active.map((c) => {
        const isOpen = c.status === "open";
        const isMine = c.creatorWallet === wallet;
        const isAcceptor = c.acceptorWallet === wallet;
        const postRemaining = isOpen ? c.createdAt + c.postDurationMs - now : 0;
        const missionRemaining = c.status === "accepted" && c.acceptedAt
          ? c.acceptedAt + c.missionDurationMs - now
          : 0;
        const isExpanded = expanded.has(c.id);

        return (
          <div key={c.id} className={`contract-card contract-${c.status}`}>
            <div className="contract-header" onClick={() => toggle(c.id)}>
              <span className="goal-expand">{isExpanded ? "▼" : "▶"}</span>
              <span className="goal-type">{GOAL_TYPE_LABELS[c.type] ?? c.type}</span>
              <span className="goal-desc">{c.description}</span>
              <span className="contract-budget">{c.budget.toLocaleString()} {cTicker(c)}</span>
              {isOpen && <span className="contract-timer">⏳ {formatCountdown(postRemaining)}</span>}
              {c.status === "accepted" && <span className="contract-timer">⏱ {formatCountdown(missionRemaining)}</span>}
              <span className={`contract-status status-${c.status}`}>{c.status}</span>
            </div>

            {isExpanded && (
              <div className="contract-body">
                <div className="contract-meta">
                  <span>By: {c.creatorName}</span>
                  {c.acceptorName && <span> · Accepted by: {c.acceptorName}</span>}
                  <span> · Deposit: {c.taxPaid.toLocaleString()} {cTicker(c)}</span>
                </div>

                {/* Delivery-specific info */}
                {c.type === "Deliver" && c.delivery && (
                  <div style={{ margin: "0.5rem 0", padding: "0.5rem", background: "rgba(100,150,255,0.06)", border: "1px solid rgba(100,150,255,0.15)", fontSize: "0.78rem" }}>
                    <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "0.3rem" }}>
                      <span>📦 → <strong>{ssuNameLookup.get(c.delivery.destinationSsuId) || c.delivery.destinationLabel || c.delivery.destinationSsuId.slice(0, 10)}</strong></span>
                      {c.delivery.collateral > 0 && <span>Collateral: <strong>{c.delivery.collateral.toLocaleString()} {cTicker(c)}</strong></span>}
                      <span>Status: <strong>{c.delivery.status}</strong></span>
                    </div>
                    {c.couriers && c.couriers.length > 0 && (
                      <div style={{ marginTop: "0.3rem" }}>
                        <span className="muted">Couriers:</span>
                        {c.couriers.map((cr, ci) => (
                          <div key={ci} style={{ marginLeft: "0.5rem", fontSize: "0.72rem" }}>
                            {cr.courierName} ({cr.status})
                            {cr.claimDigest && <span className="muted"> — ✓ picked up</span>}
                            {cr.itemsDeposited.length > 0 && (
                              <span className="muted"> — deposited: {cr.itemsDeposited.map((d) => `${d.quantity}× ${d.itemName}`).join(", ")}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {isAcceptor && c.status === "accepted" && c.delivery.status === "in-transit" && (
                      <div style={{ marginTop: "0.3rem", fontSize: "0.72rem", color: "var(--color-accent)" }}>
                        {c.couriers?.find((cr) => cr.courierWallet === wallet)?.claimDigest
                          ? "✓ Items picked up — travel to destination SSU and deposit via Incoming Deliveries"
                          : c.delivery.packageId
                            ? "Click 📦 Pick up Package below to collect all items at once"
                            : "Click 📦 on each item below to pick up from SSU storage"}
                      </div>
                    )}
                  </div>
                )}

                <div className="rolodex-container">
                  {c.missions.map((m) => {
                    const isComplete = m.completedQty >= m.quantity;
                    const display = parseMissionDisplay(m as any);
                    return (
                      <div key={m.idx} className={`rolodex-card phase-${m.phase.toLowerCase()}-card${isComplete ? " mission-complete-card" : ""}${m.isAlternative ? " mission-alt-card" : ""}`}>
                        <div className="rc-header">
                          <span className={`rc-phase phase-${m.phase.toLowerCase()}`}>
                            {m.phase} T{m.tier}
                          </span>
                          <span className="rc-progress">{m.completedQty}/{m.quantity}</span>
                          {isComplete && <span className="rc-done-badge">DONE</span>}
                        </div>
                        <div className="rc-desc">
                          {display.inputTypeId != null ? (
                            <><MissionIcon typeId={display.inputTypeId} phase="GATHER" size={18} />{display.inputName} → <MissionIcon typeId={display.outputTypeId} phase="REFINE" size={18} />{display.outputName}</>
                          ) : (
                            <><MissionIcon typeId={m.typeId ?? undefined} phase={m.phase} size={18} />{display.desc}</>
                          )}
                        </div>
                        {isAcceptor && c.status === "accepted" && !isComplete && (
                          <div className="rc-controls">
                            {c.type === "Deliver" ? (() => {
                              const isPackageContract = !!c.delivery?.packageId;
                              if (isPackageContract) return null; // handled by package button above
                              const myCourier = c.couriers?.find((cr) => cr.courierWallet === wallet);
                              const alreadyClaimed = !!myCourier?.claimDigest;
                              return alreadyClaimed ? (
                                <span className="rc-done-badge" title="Items picked up — deliver to destination">✓ Picked up</span>
                              ) : (
                                <button
                                  className="btn-contribute"
                                  disabled={!!acting}
                                  title="Pick up items from SSU storage"
                                  onClick={() => act(
                                    () => handleContractDeliveryClaim(c, m),
                                    `claim-${c.id}-${m.idx}`,
                                  )}
                                >
                                  📦
                                </button>
                              );
                            })() : (
                              <button
                                className="btn-contribute"
                                disabled={!!acting}
                                onClick={() => act(
                                  () => handleContractProgress(c, m),
                                  `progress-${c.id}-${m.idx}`,
                                )}
                              >
                                +
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {c.type === "Deliver" && c.delivery?.packageId && isAcceptor && c.status === "accepted" && (() => {
                  const myCourier = c.couriers?.find((cr) => cr.courierWallet === wallet);
                  const alreadyClaimed = !!myCourier?.claimDigest;
                  if (alreadyClaimed) return null;
                  return (
                    <div style={{ padding: "0.3rem 0.5rem", textAlign: "right" }}>
                      <button
                        className="btn-contribute"
                        disabled={!!acting}
                        onClick={() => act(() => handleContractPackageClaim(c), `pkg-claim-${c.id}`)}
                        style={{ fontSize: "0.75rem", padding: "0.25rem 0.6rem" }}
                      >
                        {acting === `pkg-claim-${c.id}` ? "Picking up…" : "📦 Pick up Package"}
                      </button>
                    </div>
                  );
                })()}

                <div className="contract-actions">
                  {isOpen && isMine && (
                    <button className="btn-subtle btn-danger" disabled={!!acting} onClick={() => act(() => onCancel(c.id), `cancel-${c.id}`)}>
                      Cancel
                    </button>
                  )}
                  {isOpen && !isMine && (
                    <button className="btn-contribute" disabled={!!acting} onClick={() => act(() => onAccept(c.id, wallet, playerName, c.taxPaid), `accept-${c.id}`)}>
                      Accept ({c.taxPaid.toLocaleString()} {cTicker(c)} deposit)
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {past.length > 0 && (
        <details className="past-contracts">
          <summary className="muted">Past contracts ({past.length})</summary>
          {past.map((c) => (
            <div key={c.id} className={`contract-card contract-${c.status} contract-past`}>
              <div className="contract-header">
                <span className="goal-type">{GOAL_TYPE_LABELS[c.type] ?? c.type}</span>
                <span className="goal-desc">{c.description}</span>
                <span className="contract-budget">{c.budget.toLocaleString()} {cTicker(c)}</span>
                <span className={`contract-status status-${c.status}`}>{c.status}</span>
              </div>
            </div>
          ))}
        </details>
      )}
    </div>
  );
}
