/**
 * Dynamic tribe coin publishing — client-side (runs in the browser).
 *
 * Compiles a unique coin module per tribe on the server via /api/compile-coin
 * (uses `sui move build`), then publishes it on-chain from the browser.
 *
 * Flow:
 *   1. Server compiles a coin module with the tribe's ticker and name
 *   2. Build a publish transaction with the compiled bytecode
 *   3. Sign & execute via the connected wallet
 *   4. Extract TreasuryCap + CoinMetadata from the effects
 *   5. Build a create_vault transaction using the TreasuryCap
 *   6. Sign & execute via the connected wallet
 *   7. Return the new deployment config
 */
import { Transaction } from "@mysten/sui/transactions";

export interface PublishTribeCoinResult {
  coinPackageId: string;
  creditCoinType: string;
  creditMetadataId: string;
  treasuryCapId: string;
  publishDigest: string;
}

export interface CreateVaultResult {
  vaultId: string;
  vaultDigest: string;
}

/**
 * Compile a coin module on the server and build a publish Transaction.
 * The caller signs and executes this transaction.
 * After execution, use extractPublishResult() on the response.
 */
export async function buildPublishCoinTransaction(
  ticker: string,
  coinName?: string,
  senderAddress?: string,
): Promise<Transaction> {
  const res = await fetch("/api/compile-coin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ticker, coinName }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(`Coin compilation failed: ${err.error}`);
  }
  const { modules, dependencies } = await res.json();

  const tx = new Transaction();
  const [upgradeCap] = tx.publish({ modules, dependencies });

  if (senderAddress) {
    tx.transferObjects([upgradeCap], senderAddress);
  }

  return tx;
}

/**
 * Extract the published package ID, TreasuryCap, and CoinMetadata
 * from a publish transaction result.
 */
export function extractPublishResult(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  txResult: any,
  ticker: string,
): PublishTribeCoinResult {
  const changes = txResult.objectChanges || [];
  const digest = txResult.digest || "";

  const publishedPkg = changes.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) => c.type === "published",
  );
  if (!publishedPkg) {
    throw new Error("Published package not found in transaction effects");
  }
  const coinPackageId = publishedPkg.packageId as string;
  const moduleName = ticker.toLowerCase();
  const creditCoinType = `${coinPackageId}::${moduleName}::${ticker.toUpperCase()}`;

  const treasuryCapChange = changes.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) =>
      c.type === "created" &&
      c.objectType?.includes("::coin::TreasuryCap<"),
  );
  if (!treasuryCapChange) {
    throw new Error("TreasuryCap not found in publish transaction effects");
  }

  const metadataChange = changes.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) =>
      c.type === "created" &&
      c.objectType?.includes("::coin::CoinMetadata<"),
  );

  return {
    coinPackageId,
    creditCoinType,
    creditMetadataId: metadataChange?.objectId ?? "",
    treasuryCapId: treasuryCapChange.objectId as string,
    publishDigest: digest,
  };
}

/**
 * Build a Transaction that creates the tribe vault using the TreasuryCap
 * from a freshly-published coin module.
 */
export function buildCreateVaultTransaction(opts: {
  plutarchPackageId: string;
  registryId: string;
  tribeId: number;
  treasuryCapId: string;
  backingCoinType: string;
  creditCoinType: string;
}): Transaction {
  const tx = new Transaction();
  tx.moveCall({
    target: `${opts.plutarchPackageId}::vault::create_vault`,
    typeArguments: [opts.backingCoinType, opts.creditCoinType],
    arguments: [
      tx.object(opts.registryId),
      tx.pure.u64(opts.tribeId),
      tx.object(opts.treasuryCapId),
    ],
  });
  return tx;
}

/**
 * Extract the vault ID from a create_vault transaction result.
 */
export function extractVaultId(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  txResult: any,
): CreateVaultResult {
  const changes = txResult.objectChanges || [];
  const vaultChange = changes.find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) =>
      c.type === "created" &&
      c.objectType?.includes("::vault::TribeVault<"),
  );
  return {
    vaultId: vaultChange?.objectId ?? "",
    vaultDigest: txResult.digest || "",
  };
}
