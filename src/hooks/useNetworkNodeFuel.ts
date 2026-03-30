import { useQuery } from "@tanstack/react-query";
import { getAssemblyWithOwner } from "@evefrontier/dapp-kit";

// ── Types ──

export interface FuelInfo {
  /** Current fuel quantity remaining (units). */
  quantity: number;
  /** Max fuel capacity. */
  maxCapacity: number;
  /** Percentage of fuel remaining (0–100). */
  percent: number;
  /** Whether fuel is actively burning. */
  isBurning: boolean;
  /** Estimated timestamp (ms) when fuel will be depleted. 0 if not burning. */
  depletionTime: number;
  /** Milliseconds until fuel runs out. Infinity if not burning or already empty. */
  msRemaining: number;
  /** Fuel type ID (game item type). */
  fuelTypeId: number;
  /** Human-readable time remaining string, e.g. "3d 14h 22m". */
  timeRemainingLabel: string;
  /** Owner address of the network node. */
  ownerAddress: string | null;
}

// ── Fuel-type consumption rates (units consumed per hour) ──
// Source: EVE Frontier in-game network node fuel data.
// Key = item type_id from on-chain fuel data.
const FUEL_RATES_PER_HOUR: Record<number, number> = {
  88335: 10,     // D1 Fuel
  88319: 6.67,   // D2 Fuel
  84868: 2.5,    // SOF-40 Fuel
  78515: 1.25,   // SOF-80 Fuel
  78437: 1.11,   // EU-90 Fuel
  78516: 2.5,    // EU-40 Fuel
};

const MS_PER_HOUR = 3_600_000;

/** Get ms to consume one item for a given fuel type. */
function getMsPerItem(fuelTypeId: number, burnRateInMs: number): number {
  const ratePerHour = FUEL_RATES_PER_HOUR[fuelTypeId];
  if (ratePerHour && ratePerHour > 0) {
    return MS_PER_HOUR / ratePerHour;
  }
  // Fallback: use raw burn_rate_in_ms as ms-per-item
  return burnRateInMs > 0 ? burnRateInMs : Infinity;
}

// ── Fuel calculation ──

export function computeFuelInfo(rawJson: Record<string, unknown>, ownerAddress: string | null): FuelInfo {
  const fuel = rawJson.fuel as Record<string, unknown> | undefined;
  if (!fuel) {
    return {
      quantity: 0, maxCapacity: 0, percent: 0, isBurning: false,
      depletionTime: 0, msRemaining: Infinity, fuelTypeId: 0,
      timeRemainingLabel: "No fuel data", ownerAddress,
    };
  }

  const quantity = Number(fuel.quantity ?? 0);
  const maxCapacity = Number(fuel.max_capacity ?? 0);
  const burnRateInMs = Number(fuel.burn_rate_in_ms ?? 0);
  const burnStartTime = Number(fuel.burn_start_time ?? 0);
  const isBurning = fuel.is_burning === true;
  const fuelTypeId = Number(fuel.type_id ?? 0);

  // Use known per-fuel-type consumption rates instead of raw burn_rate / unitVolume.
  const msPerItem = getMsPerItem(fuelTypeId, burnRateInMs);

  let effectiveQuantity = quantity;
  let msRemaining = Infinity;
  let depletionTime = 0;

  if (isBurning && isFinite(msPerItem) && msPerItem > 0) {
    const now = Date.now();
    const elapsedMs = now - burnStartTime;
    const consumedItems = Math.floor(elapsedMs / msPerItem);
    effectiveQuantity = Math.max(0, quantity - consumedItems);
    msRemaining = effectiveQuantity * msPerItem;
    depletionTime = now + msRemaining;
  }

  const percent = maxCapacity > 0 ? Math.min(100, (effectiveQuantity / maxCapacity) * 100) : 0;

  // Debug: log raw values so we can verify the formula
  console.log("[Fuel Debug]", {
    quantity, maxCapacity, burnRateInMs, burnStartTime, isBurning,
    fuelTypeId, msPerItem, effectiveQuantity, msRemaining,
    percent: percent.toFixed(2) + "%",
    timeLabel: formatTimeRemaining(msRemaining),
  });

  return {
    quantity: effectiveQuantity,
    maxCapacity,
    percent,
    isBurning,
    depletionTime,
    msRemaining,
    fuelTypeId,
    timeRemainingLabel: formatTimeRemaining(msRemaining),
    ownerAddress,
  };
}

/** Format milliseconds into a human-readable duration like "3d 14h 22m". */
export function formatTimeRemaining(ms: number): string {
  if (!isFinite(ms) || ms <= 0) return "Empty";
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}d ${hours}h ${minutes}m`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

// ── Hook ──

async function fetchNetworkNodeFuel(networkNodeId: string): Promise<FuelInfo> {
  const { moveObject, assemblyOwner: character } = await getAssemblyWithOwner(networkNodeId);
  if (!moveObject) {
    throw new Error("Network node not found on-chain");
  }
  const rawJson = moveObject.contents?.json as Record<string, unknown> | undefined;
  if (!rawJson) {
    throw new Error("No data returned from network node");
  }
  const ownerAddress = (character as { address?: string } | null)?.address ?? null;
  return computeFuelInfo(rawJson, ownerAddress);
}

/**
 * Fetch fuel information for a network node assembly.
 * Polls every 60 seconds to keep the time remaining up to date.
 */
export function useNetworkNodeFuel(networkNodeId: string | null | undefined) {
  const query = useQuery<FuelInfo>({
    queryKey: ["network-node-fuel", networkNodeId],
    queryFn: () => fetchNetworkNodeFuel(networkNodeId!),
    enabled: !!networkNodeId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  return {
    fuel: query.data ?? null,
    loading: query.isLoading && !!networkNodeId,
    error: query.error,
    refetch: query.refetch,
  };
}

/**
 * Verify a network node assembly ID on-chain.
 * Returns the owner address and fuel info if valid, or throws descriptive errors.
 */
export async function verifyNetworkNode(assemblyId: string): Promise<{
  ownerAddress: string | null;
  fuel: FuelInfo;
  state: string;
  name: string;
}> {
  const { moveObject, assemblyOwner: character } = await getAssemblyWithOwner(assemblyId);
  if (!moveObject) {
    throw new Error("Assembly not found on-chain. Check the ID and try again.");
  }

  const rawJson = moveObject.contents?.json as Record<string, unknown> | undefined;
  if (!rawJson) {
    throw new Error("Could not read assembly data.");
  }

  // Check that this is a network node (has fuel data but no inventory_keys)
  if (!rawJson.fuel) {
    throw new Error("This assembly is not a Network Node (no fuel data found). Make sure you're pasting a Network Node ID, not an SSU.");
  }

  const ownerAddress = (character as { address?: string } | null)?.address ?? null;
  const fuel = computeFuelInfo(rawJson, ownerAddress);

  const status = rawJson.status as Record<string, unknown> | undefined;
  const stateVariant = (status?.status as Record<string, string> | undefined)?.["@variant"] ?? "Unknown";

  const metadata = rawJson.metadata as Record<string, unknown> | undefined;
  const name = String(metadata?.name ?? "");

  return { ownerAddress, fuel, state: stateVariant, name };
}
