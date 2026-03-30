import { useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { useDAppKit, useCurrentAccount } from "@mysten/dapp-kit-react";
import { VAULT_COIN_TYPE, SUI_RPC_URL, SUI_NETWORK } from "../config";
import { useDeploymentConfig } from "../context/DeploymentContext";
import { friendlyTxError } from "../utils/friendlyTxError";

const rpc = new SuiJsonRpcClient({ url: SUI_RPC_URL, network: SUI_NETWORK });
const DECIMALS = 1_000_000_000;

interface TxResult {
  pending: boolean;
  error: string | null;
  digest: string | null;
}

/**
 * Convert earned off-chain credits directly to EVE tokens.
 *
 * Two-step flow (two transaction signatures):
 *   1. `vault::pay_reward`  — mints credits from the tribe budget to the user's wallet
 *   2. `vault::redeem`      — burns the credits and returns EVE (minus protocol fee)
 */
export function useConvertEarnedToEve(vaultId: string | null | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const { config } = useDeploymentConfig();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function convert(credits: number): Promise<boolean> {
    if (!account) {
      setState({ pending: false, error: "Wallet not connected", digest: null });
      return false;
    }
    if (!vaultId) {
      setState({ pending: false, error: "Vault not found for your tribe", digest: null });
      return false;
    }
    if (!config) {
      setState({ pending: false, error: "Deployment config not loaded", digest: null });
      return false;
    }

    setState({ pending: true, error: null, digest: null });

    try {
      const amountBase = BigInt(Math.floor(credits * DECIMALS));

      // ── Step 1: pay_reward → credit coin deposited to wallet ──
      const tx1 = new Transaction();
      tx1.moveCall({
        target: `${config.packageId}::vault::pay_reward`,
        typeArguments: [VAULT_COIN_TYPE, config.creditCoinType],
        arguments: [
          tx1.object(vaultId),
          tx1.pure.u64(amountBase),
          tx1.pure.address(account.address),
        ],
      });

      const res1 = await signAndExecuteTransaction({ transaction: tx1 });
      if (res1.$kind !== "Transaction") {
        setState({ pending: false, error: "Withdraw step failed on-chain", digest: null });
        return false;
      }

      // ── Step 2: redeem credits → EVE ──
      // Small delay to let the indexer catch up
      await new Promise((r) => setTimeout(r, 1500));

      const coins = await rpc.getCoins({
        owner: account.address,
        coinType: config.creditCoinType,
      });

      if (!coins.data.length) {
        // pay_reward succeeded but coins not visible yet – still partial success
        setState({
          pending: false,
          error: "Credits withdrawn to wallet but redeem couldn\u2019t find them yet. Use \u201CSell Credits\u201D to convert them to EVE.",
          digest: res1.Transaction.digest,
        });
        return false;
      }

      const tx2 = new Transaction();
      const primaryCoinId = coins.data[0].coinObjectId;
      if (coins.data.length > 1) {
        tx2.mergeCoins(
          tx2.object(primaryCoinId),
          coins.data.slice(1).map((c) => tx2.object(c.coinObjectId)),
        );
      }
      const [redeemCoin] = tx2.splitCoins(tx2.object(primaryCoinId), [tx2.pure.u64(amountBase)]);

      const eveCoin = tx2.moveCall({
        target: `${config.packageId}::vault::redeem`,
        typeArguments: [VAULT_COIN_TYPE, config.creditCoinType],
        arguments: [
          tx2.object(vaultId),
          tx2.object(config.registryId),
          redeemCoin,
        ],
      });
      tx2.transferObjects([eveCoin], account.address);

      const res2 = await signAndExecuteTransaction({ transaction: tx2 });
      if (res2.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: res2.Transaction.digest });
        return true;
      }

      setState({ pending: false, error: "Redeem step failed on-chain. Credits are in your wallet — use \u201CSell Credits\u201D.", digest: res1.Transaction.digest });
      return false;
    } catch (e: unknown) {
      setState({ pending: false, error: friendlyTxError(e), digest: null });
      return false;
    }
  }

  return { convert, ...state };
}
