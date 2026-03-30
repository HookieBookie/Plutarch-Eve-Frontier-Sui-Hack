import { useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { useDAppKit, useCurrentAccount } from "@mysten/dapp-kit-react";
import { VAULT_COIN_TYPE } from "../config";
import { useDeploymentConfig } from "../context/DeploymentContext";
import { friendlyTxError } from "../utils/friendlyTxError";

const DECIMALS = 1_000_000_000; // 1e9

interface TxResult {
  pending: boolean;
  error: string | null;
  digest: string | null;
}

/**
 * Withdraw earned credits from the vault's on-chain `credit_budget`
 * to the caller's personal wallet as real `Coin<TCREDIT>`.
 *
 * Calls `vault::pay_reward<T>(vault, amount, recipient, ctx)`.
 * The caller pays gas; no protocol fee on reward payouts.
 */
export function useWithdrawReward(vaultId: string | null | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const { config } = useDeploymentConfig();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function withdraw(credits: number): Promise<boolean> {
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
      const tx = new Transaction();

      tx.moveCall({
        target: `${config.packageId}::vault::pay_reward`,
        typeArguments: [VAULT_COIN_TYPE, config.creditCoinType],
        arguments: [
          tx.object(vaultId),
          tx.pure.u64(amountBase),
          tx.pure.address(account.address),
        ],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });

      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }

      const failDigest = result.$kind === "FailedTransaction"
        ? (result as { FailedTransaction: { digest: string } }).FailedTransaction.digest
        : null;
      setState({ pending: false, error: "Transaction failed on-chain", digest: failDigest });
      return false;
    } catch (e: unknown) {
      setState({ pending: false, error: friendlyTxError(e), digest: null });
      return false;
    }
  }

  return { withdraw, ...state };
}
