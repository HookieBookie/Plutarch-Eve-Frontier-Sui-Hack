import { useQuery } from "@tanstack/react-query";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { SUI_RPC_URL, SUI_NETWORK } from "../config";
import { useDeploymentConfig } from "../context/DeploymentContext";

const rpc = new SuiJsonRpcClient({ url: SUI_RPC_URL, network: SUI_NETWORK });

export interface VaultData {
  tribeId: number;
  eveBacking: number;
  creditSupply: number;
  backingRatio: number;
  /** Credit tokens held in the vault's tribe budget (for goal/mission rewards). */
  creditBudget: number;
}

/**
 * Read the vault object for EVE backing, credit supply, and budget.
 * With dynamic coins, the TreasuryCap is stored inside the vault itself.
 */
async function fetchVault(vaultId: string): Promise<VaultData> {
  // Fetch vault object (has eve_backing, tribe_id, credit_cap with total_supply)
  const vaultRes = await rpc.getObject({
    id: vaultId,
    options: { showContent: true },
  });

  const vaultContent = vaultRes.data?.content as
    | { dataType: string; fields: Record<string, unknown> }
    | undefined;
  if (!vaultContent || vaultContent.dataType !== "moveObject") {
    throw new Error("Vault not found");
  }

  const backing = Number(vaultContent.fields.eve_backing);
  const tribeId = Number(vaultContent.fields.tribe_id);
  const creditBudget = Number(vaultContent.fields.credit_budget ?? 0);

  // Read total supply from the wrapped TreasuryCap inside the vault
  let supply = 0;
  const creditCap = vaultContent.fields.credit_cap as
    | { fields?: { total_supply?: { fields?: { value?: string } } } }
    | undefined;
  if (creditCap?.fields?.total_supply?.fields?.value) {
    supply = Number(creditCap.fields.total_supply.fields.value);
  }

  return {
    tribeId,
    eveBacking: backing,
    creditSupply: supply,
    backingRatio: supply > 0 ? backing / supply : 0,
    creditBudget,
  };
}

export interface WalletCredits {
  credits: number;
  eveValue: number;
}

/**
 * Fetch a wallet's TCREDIT coin balance using the standard getBalance RPC.
 * Real Coin objects — visible on the explorer and transferable.
 */
async function fetchWalletCredits(
  walletAddress: string,
  vault: VaultData,
  creditCoinType: string,
): Promise<WalletCredits> {
  const balanceRes = await rpc.getBalance({
    owner: walletAddress,
    coinType: creditCoinType,
  });

  const credits = Number(BigInt(balanceRes.totalBalance));
  const eveValue = vault.creditSupply > 0
    ? (credits * vault.eveBacking) / vault.creditSupply
    : 0;

  return { credits, eveValue };
}

/** Fetches the TribeVault on-chain state. Refetches every 10s. */
export function useVaultData(vaultId: string | null | undefined) {
  const { config } = useDeploymentConfig();
  return useQuery({
    queryKey: ["plutarch-vault", vaultId],
    queryFn: () => fetchVault(vaultId!),
    refetchInterval: 10_000,
    enabled: !!vaultId && !!config,
    retry: 1,
    retryDelay: 2_000,
  });
}

/** Fetches a wallet's credit balance (real TCREDIT Coin objects). */
export function useWalletCredits(walletAddress: string | undefined, vault: VaultData | undefined, _vaultId?: string | null) {
  const { config } = useDeploymentConfig();
  return useQuery({
    queryKey: ["plutarch-wallet-credits", walletAddress, config?.creditCoinType],
    queryFn: () => fetchWalletCredits(walletAddress!, vault!, config!.creditCoinType),
    refetchInterval: 10_000,
    enabled: !!walletAddress && !!vault && !!config?.creditCoinType,
  });
}
