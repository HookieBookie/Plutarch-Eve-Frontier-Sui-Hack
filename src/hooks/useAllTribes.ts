import { useQuery } from "@tanstack/react-query";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { SUI_RPC_URL, SUI_NETWORK, WORLD_API, ADMIN_ADDRESS } from "../config";
import type { VaultData } from "./useVaultData";

const rpc = new SuiJsonRpcClient({ url: SUI_RPC_URL, network: SUI_NETWORK });

export interface TribeInfo {
  tribeId: string;
  packageId: string;
  registryId: string;
  creditCoinType: string;
  coinPackageId: string;
  /** Ticker symbol extracted from creditCoinType (e.g. "CO86") */
  ticker: string;
  /** Tribe name from World API (if enriched) */
  tribeName?: string;
  /** On-chain vault object ID */
  vaultId?: string;
  /** Live vault data (backing, supply, ratio) */
  vault?: VaultData;
}

/** Look up the vault object ID from the registry for a tribe. */
async function fetchVaultId(tribeId: number, packageId: string, registryId: string): Promise<string | null> {
  const tx = new Transaction();
  tx.moveCall({
    target: `${packageId}::registry::vault_id`,
    arguments: [tx.object(registryId), tx.pure.u64(tribeId)],
  });
  const result = await rpc.devInspectTransactionBlock({
    transactionBlock: tx,
    sender: ADMIN_ADDRESS,
  });
  const returnValues = result.results?.[0]?.returnValues;
  if (!returnValues || returnValues.length === 0) return null;
  const bytes = new Uint8Array(returnValues[0][0] as number[]);
  if (bytes.length < 2 || bytes[0] === 0) return null;
  const hex = Array.from(bytes.slice(1, 33))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

/** Read vault state from the chain. */
async function fetchVaultData(vaultId: string): Promise<VaultData | null> {
  const res = await rpc.getObject({ id: vaultId, options: { showContent: true } });
  const content = res.data?.content as
    | { dataType: string; fields: Record<string, unknown> }
    | undefined;
  if (!content || content.dataType !== "moveObject") return null;

  const backing = Number(content.fields.eve_backing);
  const tribeId = Number(content.fields.tribe_id);
  const budget = Number(content.fields.credit_budget ?? 0);
  let supply = 0;
  const cap = content.fields.credit_cap as
    | { fields?: { total_supply?: { fields?: { value?: string } } } }
    | undefined;
  if (cap?.fields?.total_supply?.fields?.value) {
    supply = Number(cap.fields.total_supply.fields.value);
  }
  return {
    tribeId,
    eveBacking: backing,
    creditSupply: supply,
    backingRatio: supply > 0 ? backing / supply : 0,
    creditBudget: budget,
  };
}

/** Fetch tribe name from World API. */
async function fetchTribeName(tribeId: string): Promise<string | null> {
  if (!WORLD_API) return null;
  try {
    const r = await fetch(`${WORLD_API}/v2/tribes/${tribeId}`);
    if (!r.ok) return null;
    const data = await r.json();
    return data?.name ?? data?.tribe?.name ?? null;
  } catch {
    return null;
  }
}

function extractTicker(coinType: string): string {
  const parts = coinType.split("::");
  return parts.length >= 3 ? parts[2] : "???";
}

/**
 * Fetch all known tribes from the backend, then enrich with on-chain vault data
 * and World API names. Returns sorted by backing ratio (highest first).
 */
async function fetchAllTribes(): Promise<TribeInfo[]> {
  const res = await fetch("/api/tribes");
  if (!res.ok) return [];
  const tribes: Array<{
    tribeId: string;
    packageId: string;
    registryId: string;
    creditCoinType: string;
    coinPackageId: string;
  }> = await res.json();

  // Enrich each tribe in parallel
  const enriched = await Promise.all(
    tribes.map(async (t): Promise<TribeInfo> => {
      const ticker = extractTicker(t.creditCoinType);
      const info: TribeInfo = { ...t, ticker };

      // Fetch vault ID
      try {
        const vid = await fetchVaultId(Number(t.tribeId), t.packageId, t.registryId);
        if (vid) {
          info.vaultId = vid;
          const vd = await fetchVaultData(vid);
          if (vd) info.vault = vd;
        }
      } catch { /* skip — vault may not exist yet */ }

      // Fetch tribe name
      try {
        const name = await fetchTribeName(t.tribeId);
        if (name) info.tribeName = name;
      } catch { /* skip */ }

      return info;
    }),
  );

  // Sort by backing ratio descending (healthiest tribes first)
  return enriched
    .filter((t) => t.vault)
    .sort((a, b) => (b.vault?.backingRatio ?? 0) - (a.vault?.backingRatio ?? 0));
}

/**
 * React Query hook: fetches and enriches all known tribes with vault data.
 * Refetches every 30s to keep backing ratios current.
 */
export function useAllTribes() {
  return useQuery({
    queryKey: ["all-tribes"],
    queryFn: fetchAllTribes,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}
