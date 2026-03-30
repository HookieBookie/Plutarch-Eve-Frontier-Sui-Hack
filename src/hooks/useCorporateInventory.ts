import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface CorporateItem {
  typeId: number;
  itemName: string;
  quantity: number;
}

export interface AllCorpClaim {
  tribeId: string;
  typeId: number;
  quantity: number;
}

async function fetchCorpInventory(ssuId: string, tribeId: string): Promise<CorporateItem[]> {
  const res = await fetch(`/api/corporate-inventory?ssuId=${ssuId}&tribeId=${tribeId}`);
  if (!res.ok) return [];
  const { items } = await res.json();
  return items ?? [];
}

async function fetchAllCorpClaims(ssuId: string): Promise<AllCorpClaim[]> {
  const res = await fetch(`/api/corporate-inventory?ssuId=${ssuId}&mode=all`);
  if (!res.ok) return [];
  const { items } = await res.json();
  return items ?? [];
}

export async function postCorpAction(
  ssuId: string,
  tribeId: string,
  action: "claim" | "release",
  typeId: number,
  itemName: string,
  quantity: number,
): Promise<boolean> {
  const res = await fetch(`/api/corporate-inventory?ssuId=${ssuId}&tribeId=${tribeId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, typeId, itemName, quantity }),
  });
  return res.ok;
}

export function useCorporateInventory(ssuId: string, tribeId: string) {
  const queryClient = useQueryClient();

  const { data: items = [], ...rest } = useQuery({
    queryKey: ["corporate-inventory", ssuId, tribeId],
    queryFn: () => fetchCorpInventory(ssuId, tribeId),
    enabled: !!ssuId && !!tribeId,
    refetchInterval: 15_000,
  });

  const { data: allClaims = [] } = useQuery({
    queryKey: ["corporate-inventory-all", ssuId],
    queryFn: () => fetchAllCorpClaims(ssuId),
    enabled: !!ssuId,
    refetchInterval: 15_000,
  });

  async function claimToCorpStorage(typeId: number, itemName: string, quantity: number): Promise<boolean> {
    const ok = await postCorpAction(ssuId, tribeId, "claim", typeId, itemName, quantity);
    if (ok) {
      queryClient.invalidateQueries({ queryKey: ["corporate-inventory", ssuId, tribeId] });
      queryClient.invalidateQueries({ queryKey: ["corporate-inventory-all", ssuId] });
    }
    return ok;
  }

  async function releaseFromCorpStorage(typeId: number, itemName: string, quantity: number): Promise<boolean> {
    const ok = await postCorpAction(ssuId, tribeId, "release", typeId, itemName, quantity);
    if (ok) {
      queryClient.invalidateQueries({ queryKey: ["corporate-inventory", ssuId, tribeId] });
      queryClient.invalidateQueries({ queryKey: ["corporate-inventory-all", ssuId] });
    }
    return ok;
  }

  /** Total claims across ALL tribes for a given typeId */
  function totalClaimed(typeId: number): number {
    return allClaims.filter((c) => c.typeId === typeId).reduce((s, c) => s + c.quantity, 0);
  }

  return { items, allClaims, claimToCorpStorage, releaseFromCorpStorage, totalClaimed, ...rest };
}
