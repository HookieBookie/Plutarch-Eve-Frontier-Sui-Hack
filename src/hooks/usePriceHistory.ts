import { useQuery } from "@tanstack/react-query";

export interface PriceSnapshot {
  tribeId: string;
  eveBacking: number;
  creditSupply: number;
  backingRatio: number;
  timestamp: number;
}

/** Fetch price history for a specific tribe. */
async function fetchPriceHistory(tribeId: string): Promise<PriceSnapshot[]> {
  const res = await fetch(`/api/price-history?tribeId=${encodeURIComponent(tribeId)}`);
  if (!res.ok) return [];
  return res.json();
}

/** Fetch latest snapshots for all tribes. */
async function fetchLatestPrices(): Promise<PriceSnapshot[]> {
  const res = await fetch("/api/price-history");
  if (!res.ok) return [];
  return res.json();
}

/** Record a price snapshot for a tribe. */
export async function recordPriceSnapshot(snap: Omit<PriceSnapshot, "timestamp">): Promise<void> {
  await fetch("/api/price-history", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(snap),
  });
}

/** Price history for one tribe. */
export function usePriceHistory(tribeId: string | undefined) {
  return useQuery({
    queryKey: ["price-history", tribeId],
    queryFn: () => fetchPriceHistory(tribeId!),
    enabled: !!tribeId,
    refetchInterval: 60_000,
  });
}

/** Latest price snapshots for all tribes. */
export function useLatestPrices() {
  return useQuery({
    queryKey: ["latest-prices"],
    queryFn: fetchLatestPrices,
    refetchInterval: 30_000,
  });
}
