import { useQueries } from "@tanstack/react-query";
import { computeFuelInfo, type FuelInfo } from "./useNetworkNodeFuel";
import type { TerritorySSU } from "./useTerritoryData";

/**
 * Fetch fuel info for all territory SSUs that have a linked network node.
 * Returns a Map of ssuId → FuelInfo.
 */
export function useTerritoryFuel(ssus: TerritorySSU[]) {
  // Deduplicate: one query per unique networkNodeId
  const nodeEntries = ssus
    .filter((s) => !!s.networkNodeId)
    .map((s) => ({ ssuId: s.ssuId, networkNodeId: s.networkNodeId! }));

  const uniqueNodeIds = [...new Set(nodeEntries.map((e) => e.networkNodeId))];

  const results = useQueries({
    queries: uniqueNodeIds.map((nodeId) => ({
      queryKey: ["network-node-fuel", nodeId],
      queryFn: async () => {
        const { getAssemblyWithOwner } = await import("@evefrontier/dapp-kit");
        const { moveObject } = await getAssemblyWithOwner(nodeId);
        if (!moveObject) throw new Error("Not found");
        const rawJson = moveObject.contents?.json as Record<string, unknown> | undefined;
        if (!rawJson?.fuel) throw new Error("No fuel");
        return { nodeId, rawJson };
      },
      staleTime: 60_000,
      refetchInterval: 60_000,
      retry: 1,
    })),
  });

  // Build nodeId → raw JSON map
  const nodeDataMap = new Map<string, Record<string, unknown>>();
  for (const r of results) {
    if (r.data) nodeDataMap.set(r.data.nodeId, r.data.rawJson);
  }

  // Build ssuId → FuelInfo map using the shared computeFuelInfo
  const fuelBySsu = new Map<string, FuelInfo>();
  for (const entry of nodeEntries) {
    const rawJson = nodeDataMap.get(entry.networkNodeId);
    if (!rawJson) continue;
    fuelBySsu.set(entry.ssuId, computeFuelInfo(rawJson, null));
  }

  return { fuelBySsu, loading: results.some((r) => r.isLoading) };
}
