import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FEE_BPS } from "../config";

export type OrderSide = "sell" | "buy";
export type OrderStatus = "active" | "filled" | "cancelled";

export interface MarketOrder {
  id: string;
  side: OrderSide;
  wallet: string;
  playerName: string;
  itemTypeId: number;
  itemName: string;
  quantity: number;
  pricePerUnit: number;
  fee: number;
  /** Total credits held in escrow for buy orders (subtotal + fee + tax). */
  escrowTotal: number;
  status: OrderStatus;
  createdAt: string;
  /** Tribe that placed this order. */
  tribeId?: string;
  /** "tribal" (default, visible to tribe only) or "public" (visible to all). */
  visibility?: "tribal" | "public";
  /** Set when this order is a package listing. */
  packageId?: string | null;
  /** Items in the package (only present for package orders). */
  packageItems?: { itemTypeId: number; itemName: string; quantity: number }[];
}

export interface MarketHistory {
  id: string;
  side: OrderSide;
  buyer: string;
  seller: string;
  itemTypeId: number;
  itemName: string;
  quantity: number;
  pricePerUnit: number;
  fee: number;
  completedAt: string;
}

interface MarketStore {
  orders: MarketOrder[];
  history: MarketHistory[];
}

function marketKey(ssuId: string, tribeId: string) {
  return ["market", ssuId, tribeId];
}

function apiUrl(ssuId: string, tribeId: string) {
  return `/api/market?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`;
}

async function loadMarket(ssuId: string, tribeId: string): Promise<MarketStore> {
  const res = await fetch(apiUrl(ssuId, tribeId));
  const data = await res.json();
  return { orders: data?.orders ?? [], history: data?.history ?? [] };
}

/** Calculate the 1% protocol fee in credits. */
export function calcFee(quantity: number, pricePerUnit: number): number {
  return Math.ceil((quantity * pricePerUnit * FEE_BPS) / 10_000);
}

/* ── Off-chain balance helpers (atomic server-side operations) ── */

async function readBalance(tribeId: string, address: string): Promise<number> {
  const res = await fetch(
    `/api/balance?tribeId=${encodeURIComponent(tribeId)}&wallet=${encodeURIComponent(address)}`,
  );
  const data = await res.json();
  return data.balance ?? 0;
}

async function adjustBalance(tribeId: string, address: string, delta: number): Promise<number> {
  const res = await fetch(`/api/balance?tribeId=${encodeURIComponent(tribeId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: address, delta }),
  });
  const data = await res.json();
  return data.balance ?? 0;
}

export function useMarketOrders(ssuId: string, tribeId: string) {
  const qc = useQueryClient();
  const key = marketKey(ssuId, tribeId);

  const query = useQuery<MarketStore>({
    queryKey: key,
    queryFn: () => loadMarket(ssuId, tribeId),
    enabled: !!ssuId && !!tribeId,
    staleTime: 5_000,
    refetchOnMount: "always",
  });

  /**
   * Place a new order.
   * - BUY: debits buyer's off-chain balance for the full cost (escrow).
   *        Uses earned credits first, then wallet credits for the remainder.
   * - SELL: requires pre-validation that the seller has items (done in UI).
   */
  const placeOrder = useMutation({
    mutationFn: async (order: Omit<MarketOrder, "id" | "createdAt" | "status" | "fee" | "escrowTotal"> & { taxBps?: number; walletCredits?: number; walletTopUp?: number }) => {
      const fee = calcFee(order.quantity, order.pricePerUnit);
      const subtotal = order.quantity * order.pricePerUnit;
      const tax = order.taxBps ? Math.ceil((subtotal * order.taxBps) / 10_000) : 0;
      const escrowTotal = subtotal + fee + tax;

      if (order.side === "buy") {
        // If the caller authorised a wallet-to-earned transfer, credit it first
        if (order.walletTopUp && order.walletTopUp > 0) {
          await adjustBalance(tribeId, order.wallet, order.walletTopUp);
        }
        const earned = await readBalance(tribeId, order.wallet);
        if (earned < escrowTotal) {
          throw new Error(`Insufficient earned credits. Need ${escrowTotal.toLocaleString()} but you have ${earned.toLocaleString()}.`);
        }
        // Debit the full escrow from off-chain earned balance
        await adjustBalance(tribeId, order.wallet, -escrowTotal);
      }

      const newOrder: MarketOrder = {
        side: order.side,
        wallet: order.wallet,
        playerName: order.playerName,
        itemTypeId: order.itemTypeId,
        itemName: order.itemName,
        quantity: order.quantity,
        pricePerUnit: order.pricePerUnit,
        id: crypto.randomUUID(),
        fee,
        escrowTotal,
        status: "active",
        createdAt: new Date().toISOString(),
        visibility: order.visibility ?? "tribal",
      };
      await fetch(`${apiUrl(ssuId, tribeId)}&action=place`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newOrder),
      });
      return newOrder;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["offchain-balance"] });
    },
  });

  /**
   * Cancel an order. Refunds escrowed credits for buy orders.
   */
  const cancelOrder = useMutation({
    mutationFn: async (params: { orderId: string; wallet: string }) => {
      // Read order to check ownership + calculate refund
      const store = await loadMarket(ssuId, tribeId);
      const order = store.orders.find((o) => o.id === params.orderId && o.status === "active");
      if (!order) throw new Error("Order not found or already filled");
      if (order.wallet !== params.wallet) throw new Error("Not your order");

      // Refund the escrowed subtotal + tax, but keep the listing fee
      const refund = order.side === "buy"
        ? (order.escrowTotal || (order.quantity * order.pricePerUnit + order.fee)) - order.fee
        : 0;

      // Server atomically cancels + refunds in a transaction
      await fetch(`${apiUrl(ssuId, tribeId)}&action=cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId: params.orderId,
          wallet: params.wallet,
          refund: refund || undefined,
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["offchain-balance"] });
      qc.invalidateQueries({ queryKey: ["packages"] });
    },
  });

  /**
   * Fill an order (match a trade).
   * Supports partial fills: if fillQuantity < order.quantity, the order stays
   * active with the remaining quantity.
   */
  const fillOrder = useMutation({
    mutationFn: async (params: {
      orderId: string;
      fillerWallet: string;
      fillerName: string;
      fillQuantity?: number;
      taxBps?: number;
      walletCredits?: number;
      walletTopUp?: number;
    }) => {
      // Read the order to validate + compute amounts
      const store = await loadMarket(ssuId, tribeId);
      const order = store.orders.find((o) => o.id === params.orderId && o.status === "active");
      if (!order) throw new Error("Order not found or already filled");

      const fillQty = params.fillQuantity ?? order.quantity;
      if (fillQty <= 0 || fillQty > order.quantity) {
        throw new Error(`Invalid quantity. Must be 1–${order.quantity}.`);
      }
      const isPartial = fillQty < order.quantity;

      const subtotal = fillQty * order.pricePerUnit;
      const fee = calcFee(fillQty, order.pricePerUnit);
      const tax = params.taxBps ? Math.ceil((subtotal * params.taxBps) / 10_000) : 0;
      const buyerTotal = subtotal + fee + tax;

      // Build the balance operations to run atomically on the server
      // Include tribeId per op so cross-tribe fills adjust the correct economies
      const balanceOps: { wallet: string; delta: number; tribeId?: string }[] = [];

      if (order.side === "sell") {
        // Filler is buying — if they authorised a wallet top-up, credit it first
        if (params.walletTopUp && params.walletTopUp > 0) {
          balanceOps.push({ wallet: params.fillerWallet, delta: params.walletTopUp });
        }
        const earned = await readBalance(tribeId, params.fillerWallet);
        const available = earned + (params.walletTopUp ?? 0);
        if (available < buyerTotal) {
          throw new Error(`Insufficient earned credits. Need ${buyerTotal.toLocaleString()} but you have ${available.toLocaleString()}.`);
        }
        balanceOps.push({ wallet: params.fillerWallet, delta: -buyerTotal });
        // Credit the seller (order placer)
        balanceOps.push({ wallet: order.wallet, delta: subtotal });
      } else {
        // Filler is selling — buyer already escrowed on placement.
        balanceOps.push({ wallet: params.fillerWallet, delta: subtotal });
      }

      const historyEntry: MarketHistory = {
        id: crypto.randomUUID(),
        side: order.side,
        buyer: order.side === "buy" ? order.wallet : params.fillerWallet,
        seller: order.side === "sell" ? order.wallet : params.fillerWallet,
        itemTypeId: order.itemTypeId,
        itemName: order.itemName,
        quantity: fillQty,
        pricePerUnit: order.pricePerUnit,
        fee,
        completedAt: new Date().toISOString(),
      };

      if (isPartial) {
        const remainingQty = order.quantity - fillQty;
        const remainingFee = calcFee(remainingQty, order.pricePerUnit);
        const remainingSubtotal = remainingQty * order.pricePerUnit;
        const remainingTax = params.taxBps ? Math.ceil((remainingSubtotal * params.taxBps) / 10_000) : 0;
        const remainingEscrow = order.side === "buy" ? remainingSubtotal + remainingFee + remainingTax : 0;

        await fetch(`${apiUrl(ssuId, tribeId)}&action=partial-fill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            orderId: params.orderId,
            remainingQuantity: remainingQty,
            remainingFee,
            remainingEscrow,
            balanceOps,
            historyEntry,
          }),
        });
      } else {
        // Full fill — mark order as filled
        await fetch(`${apiUrl(ssuId, tribeId)}&action=fill`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId: params.orderId, balanceOps, historyEntry }),
        });
      }

      return historyEntry;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: key });
      qc.invalidateQueries({ queryKey: ["offchain-balance"] });
      qc.invalidateQueries({ queryKey: ["ssu-inventory"] });
    },
  });

  const activeOrders = (query.data?.orders ?? []).filter((o) => o.status === "active");
  const sellOrders = activeOrders.filter((o) => o.side === "sell").sort((a, b) => a.pricePerUnit - b.pricePerUnit);
  const buyOrders = activeOrders.filter((o) => o.side === "buy").sort((a, b) => b.pricePerUnit - a.pricePerUnit);

  return {
    ...query,
    orders: query.data?.orders ?? [],
    history: query.data?.history ?? [],
    activeOrders,
    sellOrders,
    buyOrders,
    placeOrder,
    cancelOrder,
    fillOrder,
  };
}
