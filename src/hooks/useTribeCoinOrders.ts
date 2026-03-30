import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface TribeCoinOrder {
  id: string;
  wallet: string;
  playerName: string;
  sourceTribeId: string;
  targetTribeId: string;
  side: string;
  quantity: number;
  limitRate: number;
  status: string;
  createdAt: number;
}

/** Fetch open orders for a tribe pair. */
async function fetchPairOrders(sourceTribeId: string, targetTribeId: string): Promise<TribeCoinOrder[]> {
  const params = new URLSearchParams({ sourceTribeId, targetTribeId });
  const res = await fetch(`/api/tribe-orders?${params}`);
  if (!res.ok) return [];
  return res.json();
}

/** Fetch open orders for a wallet. */
async function fetchWalletOrders(wallet: string): Promise<TribeCoinOrder[]> {
  const res = await fetch(`/api/tribe-orders?wallet=${encodeURIComponent(wallet)}`);
  if (!res.ok) return [];
  return res.json();
}

/** Open orders for a specific tribe pair. */
export function useTribeCoinOrders(sourceTribeId: string | undefined, targetTribeId: string | undefined) {
  return useQuery({
    queryKey: ["tribe-coin-orders", sourceTribeId, targetTribeId],
    queryFn: () => fetchPairOrders(sourceTribeId!, targetTribeId!),
    enabled: !!sourceTribeId && !!targetTribeId,
    refetchInterval: 10_000,
  });
}

/** Open orders for the connected wallet. */
export function useMyTribeCoinOrders(wallet: string | undefined) {
  return useQuery({
    queryKey: ["my-tribe-coin-orders", wallet],
    queryFn: () => fetchWalletOrders(wallet!),
    enabled: !!wallet,
    refetchInterval: 10_000,
  });
}

/** Mutation helpers for tribe coin orders. */
export function useTribeCoinOrderMutations() {
  const qc = useQueryClient();

  async function placeOrder(order: Omit<TribeCoinOrder, "id" | "createdAt" | "status">): Promise<boolean> {
    const res = await fetch("/api/tribe-orders?action=place", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ["tribe-coin-orders"] });
      qc.invalidateQueries({ queryKey: ["my-tribe-coin-orders"] });
    }
    return res.ok;
  }

  async function cancelOrder(id: string): Promise<boolean> {
    const res = await fetch("/api/tribe-orders?action=cancel", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    if (res.ok) {
      qc.invalidateQueries({ queryKey: ["tribe-coin-orders"] });
      qc.invalidateQueries({ queryKey: ["my-tribe-coin-orders"] });
    }
    return res.ok;
  }

  return { placeOrder, cancelOrder };
}
