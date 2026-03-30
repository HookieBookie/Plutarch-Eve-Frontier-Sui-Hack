import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

/**
 * Off-chain earned credit balance, stored per-tribe in SQLite.
 * Credits accumulate here when missions are completed and can be
 * withdrawn on-chain via `pay_reward`.
 */

async function fetchBalance(tribeId: string, address: string): Promise<number> {
  const res = await fetch(
    `/api/balance?tribeId=${encodeURIComponent(tribeId)}&wallet=${encodeURIComponent(address)}`,
  );
  const data = await res.json();
  return data.balance ?? 0;
}

async function creditBalance(tribeId: string, address: string, amount: number): Promise<number> {
  const res = await fetch(`/api/balance?tribeId=${encodeURIComponent(tribeId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: address, delta: amount }),
  });
  const data = await res.json();
  return data.balance ?? 0;
}

async function debitBalance(tribeId: string, address: string, amount: number): Promise<number> {
  const res = await fetch(`/api/balance?tribeId=${encodeURIComponent(tribeId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ wallet: address, delta: -amount }),
  });
  const data = await res.json();
  return data.balance ?? 0;
}

/** Read the off-chain earned credit balance for a wallet. */
export function useOffChainBalance(tribeId: string | undefined, address: string | undefined) {
  return useQuery({
    queryKey: ["offchain-balance", tribeId, address],
    queryFn: () => fetchBalance(tribeId!, address!),
    enabled: !!tribeId && !!address,
    refetchInterval: 5_000,
  });
}

/** Returns helpers to credit / debit the off-chain balance. */
export function useOffChainBalanceMutations(tribeId: string | undefined, address: string | undefined) {
  const qc = useQueryClient();

  const credit = useCallback(
    async (amount: number) => {
      if (!tribeId || !address) return 0;
      const newBal = await creditBalance(tribeId, address, amount);
      qc.setQueryData(["offchain-balance", tribeId, address], newBal);
      return newBal;
    },
    [tribeId, address, qc],
  );

  const debit = useCallback(
    async (amount: number) => {
      if (!tribeId || !address) return 0;
      const newBal = await debitBalance(tribeId, address, amount);
      qc.setQueryData(["offchain-balance", tribeId, address], newBal);
      return newBal;
    },
    [tribeId, address, qc],
  );

  return { credit, debit };
}
