import { useQuery } from "@tanstack/react-query";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { SUI_RPC_URL, SUI_NETWORK, EVE_TOKEN_TYPE } from "../config";

const rpc = new SuiJsonRpcClient({ url: SUI_RPC_URL, network: SUI_NETWORK });

const SUI_TYPE = "0x2::sui::SUI";

export interface TokenBalances {
  /** SUI balance in MIST (1 SUI = 1e9 MIST) */
  suiRaw: bigint;
  /** SUI balance as a human-readable number */
  sui: number;
  /** EVE balance in smallest unit */
  eveRaw: bigint;
  /** EVE balance as a human-readable number */
  eve: number;
}

async function fetchBalances(walletAddress: string): Promise<TokenBalances> {
  // Fetch SUI balance
  const suiBalance = await rpc.getBalance({ owner: walletAddress, coinType: SUI_TYPE });
  const suiRaw = BigInt(suiBalance.totalBalance);

  // Fetch EVE balance
  let eveRaw = 0n;
  if (EVE_TOKEN_TYPE) {
    try {
      const eveBalance = await rpc.getBalance({ owner: walletAddress, coinType: EVE_TOKEN_TYPE });
      eveRaw = BigInt(eveBalance.totalBalance);
    } catch {
      // Token not found or no balance
    }
  }

  return {
    suiRaw,
    sui: Number(suiRaw) / 1e9,
    eveRaw,
    eve: Number(eveRaw) / 1e9,
  };
}

export function useTokenBalances(walletAddress: string | undefined) {
  return useQuery({
    queryKey: ["token-balances", walletAddress],
    queryFn: () => fetchBalances(walletAddress!),
    enabled: !!walletAddress,
    refetchInterval: 15_000,
    retry: 1,
  });
}
