import { useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { useDAppKit, useCurrentAccount } from "@mysten/dapp-kit-react";
import { VAULT_COIN_TYPE, SUI_RPC_URL, SUI_NETWORK } from "../config";
import { friendlyTxError } from "../utils/friendlyTxError";
import type { TribeInfo } from "./useAllTribes";

const rpc = new SuiJsonRpcClient({ url: SUI_RPC_URL, network: SUI_NETWORK });
const DECIMALS = 1_000_000_000;

interface TxResult {
  pending: boolean;
  error: string | null;
  digest: string | null;
}

/**
 * Cross-tribe swap: redeem source tribe credits → EVE → deposit into target tribe vault.
 * Both steps happen in a single Programmable Transaction Block (atomic).
 *
 * The EVE output from redeem flows directly into deposit — never touches the user's wallet.
 */
export function useCrossSwap() {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function crossSwap(
    sourceTribe: TribeInfo,
    targetTribe: TribeInfo,
    creditAmount: number,
  ): Promise<boolean> {
    if (!account) {
      setState({ pending: false, error: "Wallet not connected", digest: null });
      return false;
    }
    if (!sourceTribe.vaultId || !targetTribe.vaultId) {
      setState({ pending: false, error: "Vault not found for one or both tribes", digest: null });
      return false;
    }

    setState({ pending: true, error: null, digest: null });
    try {
      const creditsBase = BigInt(Math.floor(creditAmount * DECIMALS));
      const tx = new Transaction();

      // Step 1: Collect source tribe credit coins from wallet
      const coins = await rpc.getCoins({
        owner: account.address,
        coinType: sourceTribe.creditCoinType,
      });
      if (!coins.data.length) {
        setState({ pending: false, error: `No ${sourceTribe.ticker} coins found in wallet`, digest: null });
        return false;
      }

      const primaryCoinId = coins.data[0].coinObjectId;
      if (coins.data.length > 1) {
        tx.mergeCoins(
          tx.object(primaryCoinId),
          coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
        );
      }
      const [redeemCoin] = tx.splitCoins(tx.object(primaryCoinId), [tx.pure.u64(creditsBase)]);

      // Step 2: Redeem source credits → receive EVE
      const eveCoin = tx.moveCall({
        target: `${sourceTribe.packageId}::vault::redeem`,
        typeArguments: [VAULT_COIN_TYPE, sourceTribe.creditCoinType],
        arguments: [
          tx.object(sourceTribe.vaultId),
          tx.object(sourceTribe.registryId),
          redeemCoin,
        ],
      });

      // Step 3: Deposit EVE into target tribe vault → credits minted to wallet
      tx.moveCall({
        target: `${targetTribe.packageId}::vault::deposit`,
        typeArguments: [VAULT_COIN_TYPE, targetTribe.creditCoinType],
        arguments: [
          tx.object(targetTribe.vaultId),
          tx.object(targetTribe.registryId),
          eveCoin,
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

  /**
   * Buy target tribe credits using EVE directly (single-hop deposit).
   */
  async function buyWithEve(
    targetTribe: TribeInfo,
    eveAmount: number,
  ): Promise<boolean> {
    if (!account) {
      setState({ pending: false, error: "Wallet not connected", digest: null });
      return false;
    }
    if (!targetTribe.vaultId) {
      setState({ pending: false, error: "Target vault not found", digest: null });
      return false;
    }

    setState({ pending: true, error: null, digest: null });
    try {
      const amountBase = BigInt(Math.floor(eveAmount * DECIMALS));
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
        target: `${targetTribe.packageId}::vault::deposit`,
        typeArguments: [VAULT_COIN_TYPE, targetTribe.creditCoinType],
        arguments: [
          tx.object(targetTribe.vaultId),
          tx.object(targetTribe.registryId),
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

  return { crossSwap, buyWithEve, ...state };
}
