/**
 * Verify a claim_supply transaction digest on-chain.
 *
 * Queries the Sui RPC for the transaction, checks that it:
 * 1. Was successful (status === "success")
 * 2. Contains a claim_supply Move call to the expected extension package
 *
 * This is used at the destination SSU so the owner can verify that the
 * courier actually claimed items on-chain, without needing to check
 * ephemeral inventory (which the owner cannot see).
 */
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { SUI_RPC_URL, SUI_NETWORK, EXTENSION_PACKAGE_ID } from "../config";

const rpc = new SuiJsonRpcClient({ url: SUI_RPC_URL, network: SUI_NETWORK });

const EXT_PKG = EXTENSION_PACKAGE_ID;

export interface ClaimVerification {
  valid: boolean;
  sender?: string;
  error?: string;
}

/**
 * Verify that a transaction digest represents a successful claim_supply call.
 */
export async function verifyClaimDigest(digest: string): Promise<ClaimVerification> {
  try {
    await rpc.waitForTransaction({ digest });
    const tx = await rpc.getTransactionBlock({
      digest,
      options: {
        showInput: true,
        showEffects: true,
      },
    });

    // Check transaction succeeded
    const status = (tx as any).effects?.status?.status;
    if (status !== "success") {
      return { valid: false, error: `Transaction status: ${status}` };
    }

    // Check it contains a claim_supply call to our extension package
    const transactions = (tx as any).transaction?.data?.transaction?.transactions ?? [];
    const hasClaimSupply = transactions.some((t: any) => {
      if (t.MoveCall) {
        const pkg = t.MoveCall.package;
        const fn = t.MoveCall.function;
        return pkg === EXT_PKG && fn === "claim_supply";
      }
      return false;
    });

    if (!hasClaimSupply) {
      return { valid: false, error: "Transaction does not contain a claim_supply call" };
    }

    const sender = (tx as any).transaction?.data?.sender;
    return { valid: true, sender };
  } catch (e) {
    return { valid: false, error: `Verification failed: ${(e as Error).message}` };
  }
}
