import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

export interface DeliveryItem {
  typeId: number;
  itemName: string;
  quantity: number;
}

export interface DeliveryCourier {
  id: number;
  deliveryId: string;
  courierWallet: string;
  courierName: string;
  itemsDistributed: DeliveryItem[];
  itemsDeposited: DeliveryItem[];
  status: string;
  acceptedAt: number;
  completedAt: number | null;
  claimDigest: string | null;
}

export interface Delivery {
  id: string;
  sourceType: string;
  sourceId: string;
  ssuId: string;
  tribeId: string;
  destinationSsuId: string;
  destinationTribeId: string;
  destinationLabel: string;
  packageId?: string;
  items: DeliveryItem[];
  collateral: number;
  timerMs: number;
  status: string;
  createdAt: number;
  couriers: DeliveryCourier[];
}

async function fetchDeliveries(ssuId: string, tribeId: string): Promise<Delivery[]> {
  const res = await fetch(
    `/api/deliveries?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
  );
  const data = await res.json();
  return data?.deliveries ?? [];
}

async function fetchIncomingDeliveries(ssuId: string): Promise<Delivery[]> {
  const res = await fetch(
    `/api/deliveries?ssuId=${encodeURIComponent(ssuId)}&mode=destination`,
  );
  const data = await res.json();
  return data?.deliveries ?? [];
}

async function postDeliveryAction(
  ssuId: string,
  tribeId: string,
  action: string,
  body: Record<string, unknown>,
): Promise<any> {
  const res = await fetch(
    `/api/deliveries?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}&action=${action}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error ?? "Request failed");
  }
  return res.json();
}

/** Hook: outgoing deliveries from this SSU. */
export function useDeliveries(ssuId: string, tribeId: string) {
  return useQuery({
    queryKey: ["deliveries", ssuId, tribeId],
    queryFn: () => fetchDeliveries(ssuId, tribeId),
    enabled: !!ssuId && !!tribeId,
    refetchInterval: 15_000,
  });
}

/** Hook: incoming deliveries targeting this SSU. */
export function useIncomingDeliveries(ssuId: string) {
  return useQuery({
    queryKey: ["incoming-deliveries", ssuId],
    queryFn: () => fetchIncomingDeliveries(ssuId),
    enabled: !!ssuId,
    refetchInterval: 15_000,
  });
}

/** Hook: delivery actions (create, accept, progress, fail, cancel). */
export function useDeliveryActions(ssuId: string, tribeId: string) {
  const qc = useQueryClient();

  const refresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["deliveries"] });
    qc.invalidateQueries({ queryKey: ["incoming-deliveries"] });
  }, [qc]);

  const createDelivery = useCallback(
    async (data: {
      sourceType: string;
      sourceId: string;
      destinationSsuId: string;
      destinationTribeId?: string;
      destinationLabel?: string;
      items: DeliveryItem[];
      packageId?: string;
      collateral?: number;
      timerMs?: number;
    }) => {
      const result = await postDeliveryAction(ssuId, tribeId, "create", data);
      refresh();
      return result;
    },
    [ssuId, tribeId, refresh],
  );

  const acceptDelivery = useCallback(
    async (deliveryId: string, wallet: string, playerName: string, claimDigest?: string) => {
      await postDeliveryAction(ssuId, tribeId, "accept", { deliveryId, wallet, playerName, claimDigest });
      refresh();
    },
    [ssuId, tribeId, refresh],
  );

  const progressDelivery = useCallback(
    async (deliveryId: string, wallet: string, items: DeliveryItem[]) => {
      await postDeliveryAction(ssuId, tribeId, "progress", { deliveryId, wallet, items });
      refresh();
    },
    [ssuId, tribeId, refresh],
  );

  const failDelivery = useCallback(
    async (deliveryId: string) => {
      await postDeliveryAction(ssuId, tribeId, "fail", { deliveryId });
      refresh();
    },
    [ssuId, tribeId, refresh],
  );

  const cancelDelivery = useCallback(
    async (deliveryId: string) => {
      await postDeliveryAction(ssuId, tribeId, "cancel", { deliveryId });
      refresh();
    },
    [ssuId, tribeId, refresh],
  );

  return { createDelivery, acceptDelivery, progressDelivery, failDelivery, cancelDelivery, refresh };
}
