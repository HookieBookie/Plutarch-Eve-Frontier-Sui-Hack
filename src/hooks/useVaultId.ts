import { useQuery } from "@tanstack/react-query";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { SUI_RPC_URL, SUI_NETWORK, ADMIN_ADDRESS } from "../config";
import { useDeploymentConfig } from "../context/DeploymentContext";

const rpc = new SuiJsonRpcClient({ url: SUI_RPC_URL, network: SUI_NETWORK });

/**
 * Look up the TribeVault object ID from the on-chain registry for a given tribe.
 * Calls `registry::vault_id(registry, tribe_id)` via devInspect.
 */
export async function fetchVaultId(tribeId: number, packageId: string, registryId: string): Promise<string | null> {
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
  // BCS Option<ID>: 0x00 = None, 0x01 + 32 address bytes = Some(id)
  if (bytes.length < 2 || bytes[0] === 0) return null;

  const hex = Array.from(bytes.slice(1, 33))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `0x${hex}`;
}

/**
 * React Query hook that resolves the vault object ID for the given tribe
 * by querying the on-chain TribeRegistry.
 */
export function useVaultId(tribeId: number | undefined) {
  const { config } = useDeploymentConfig();
  return useQuery({
    queryKey: ["vault-id", tribeId, config?.packageId],
    queryFn: () => fetchVaultId(tribeId!, config!.packageId, config!.registryId),
    enabled: tribeId != null && tribeId > 0 && !!config?.packageId && !!config?.registryId,
    staleTime: 30_000,
    retry: 1,
  });
}
