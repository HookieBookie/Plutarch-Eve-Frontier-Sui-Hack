import { useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { useDAppKit, useCurrentAccount } from "@mysten/dapp-kit-react";
import {
  VAULT_COIN_TYPE,
  SUI_RPC_URL,
  SUI_NETWORK,
} from "../config";
import { useDeploymentConfig } from "../context/DeploymentContext";
import { friendlyTxError } from "../utils/friendlyTxError";

const rpc = new SuiJsonRpcClient({ url: SUI_RPC_URL, network: SUI_NETWORK });
const DECIMALS = 1_000_000_000; // 1e9 — both SUI and EVE use 9 decimals

interface TxResult {
  pending: boolean;
  error: string | null;
  digest: string | null;
}

/**
 * Build & sign a deposit transaction through the connected wallet.
 * `deposit(amount)` takes whole-token amounts (e.g. 1 = 1 EVE).
 * Uses the per-tribe credit coin type for minting via the vault's TreasuryCap.
 */
export function useDeposit(vaultId: string | null | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const { config } = useDeploymentConfig();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function deposit(amount: number): Promise<boolean> {
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
      const amountBase = BigInt(Math.floor(amount * DECIMALS));
      const tx = new Transaction();

      const isSui = VAULT_COIN_TYPE === "0x2::sui::SUI";
      let depositCoin;

      if (isSui) {
        [depositCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountBase)]);
      } else {
        // For non-SUI tokens (EVE): fetch coin objects, merge, then split
        const coins = await rpc.getCoins({
          owner: account.address,
          coinType: VAULT_COIN_TYPE,
        });

        if (!coins.data.length) {
          setState({ pending: false, error: "No EVE coins found in wallet", digest: null });
          return false;
        }

        const primaryCoinId = coins.data[0].coinObjectId;
        if (coins.data.length > 1) {
          tx.mergeCoins(
            tx.object(primaryCoinId),
            coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
          );
        }
        [depositCoin] = tx.splitCoins(tx.object(primaryCoinId), [tx.pure.u64(amountBase)]);
      }

      tx.moveCall({
        target: `${config.packageId}::vault::deposit`,
        typeArguments: [VAULT_COIN_TYPE, config.creditCoinType],
        arguments: [
          tx.object(vaultId),
          tx.object(config.registryId),
          depositCoin,
        ],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });

      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }

      // Transaction failed on-chain
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

  return { deposit, ...state };
}

/**
 * Build & sign a redeem transaction through the connected wallet.
 * `redeem(credits)` takes whole-token credit amounts.
 * Now fetches real TCREDIT coin objects, merges them, and passes them to the contract.
 */
export function useRedeem(vaultId: string | null | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const { config } = useDeploymentConfig();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function redeem(creditsToRedeem: number): Promise<boolean> {
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
      const creditsBase = BigInt(Math.floor(creditsToRedeem * DECIMALS));
      const tx = new Transaction();

      // Fetch all TCREDIT coin objects owned by the user
      const coins = await rpc.getCoins({
        owner: account.address,
        coinType: config.creditCoinType,
      });

      if (!coins.data.length) {
        setState({ pending: false, error: "No tribe credit coins found in wallet", digest: null });
        return false;
      }

      // Merge all TCREDIT coins into the first one, then split the exact amount
      const primaryCoinId = coins.data[0].coinObjectId;
      if (coins.data.length > 1) {
        tx.mergeCoins(
          tx.object(primaryCoinId),
          coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
        );
      }
      const [redeemCoin] = tx.splitCoins(tx.object(primaryCoinId), [tx.pure.u64(creditsBase)]);

      const eveCoin = tx.moveCall({
        target: `${config.packageId}::vault::redeem`,
        typeArguments: [VAULT_COIN_TYPE, config.creditCoinType],
        arguments: [
          tx.object(vaultId),
          tx.object(config.registryId),
          redeemCoin,
        ],
      });
      tx.transferObjects([eveCoin], account.address);

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

  return { redeem, ...state };
}

/**
 * Fund the tribe budget: deposits EVE into the vault and mints TCREDIT into
 * the vault's on-chain `credit_budget` (NOT the caller's personal wallet).
 * `fundBudget(amount)` takes whole-token EVE amounts.
 */
export function useFundBudget(vaultId: string | null | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const { config } = useDeploymentConfig();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function fundBudget(amount: number): Promise<boolean> {
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
      const amountBase = BigInt(Math.floor(amount * DECIMALS));
      const tx = new Transaction();

      const isSui = VAULT_COIN_TYPE === "0x2::sui::SUI";
      let depositCoin;

      if (isSui) {
        [depositCoin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountBase)]);
      } else {
        const coins = await rpc.getCoins({
          owner: account.address,
          coinType: VAULT_COIN_TYPE,
        });

        if (!coins.data.length) {
          setState({ pending: false, error: "No EVE coins found in wallet", digest: null });
          return false;
        }

        const primaryCoinId = coins.data[0].coinObjectId;
        if (coins.data.length > 1) {
          tx.mergeCoins(
            tx.object(primaryCoinId),
            coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
          );
        }
        [depositCoin] = tx.splitCoins(tx.object(primaryCoinId), [tx.pure.u64(amountBase)]);
      }

      tx.moveCall({
        target: `${config.packageId}::vault::fund_budget`,
        typeArguments: [VAULT_COIN_TYPE, config.creditCoinType],
        arguments: [
          tx.object(vaultId),
          tx.object(config.registryId),
          depositCoin,
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

  return { fundBudget, ...state };
}
