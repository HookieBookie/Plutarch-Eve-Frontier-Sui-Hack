/**
 * Dynamic tribe coin publishing — client-side (runs in the browser).
 *
 * Patches pre-compiled Move bytecode with the tribe's ticker/name using
 * @mysten/move-bytecode-template, then publishes it on-chain from the browser.
 * No server-side `sui` CLI required.
 *
 * Flow:
 *   1. Patch the coin template bytecode with the tribe's ticker and name
 *   2. Build a publish transaction with the patched bytecode
 *   3. Sign & execute via the connected wallet
 *   4. Extract TreasuryCap + CoinMetadata from the effects
 *   5. Build a create_vault transaction using the TreasuryCap
 *   6. Sign & execute via the connected wallet
 *   7. Return the new deployment config
 */
import { Transaction } from "@mysten/sui/transactions";
import initWasm, { update_identifiers, update_constants } from "@mysten/move-bytecode-template";
import { COIN_TEMPLATE_BYTECODE, COIN_TEMPLATE_DEPENDENCIES } from "./coinTemplateBytecode";

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
 * Patch the pre-compiled coin template bytecode with a tribe's ticker/name
 * and build a publish Transaction. No server-side compilation needed.
 */
export async function buildPublishCoinTransaction(
  ticker: string,
  coinName?: string,
  senderAddress?: string,
): Promise<Transaction> {
  // Initialise the WASM module (no-op if already initialised)
  await initWasm();

  const symbol = ticker.toUpperCase();
  const modName = ticker.toLowerCase();
  const name = coinName ?? `${symbol} Credits`;

  // Decode the pre-compiled template bytecode
  const templateBytes = Uint8Array.from(atob(COIN_TEMPLATE_BYTECODE), (c) => c.charCodeAt(0));

  // Patch identifiers: module name + OTW struct
  let patched = update_identifiers(templateBytes, {
    COIN_TEMPLATE: symbol,
    coin_template: modName,
  });

  // Patch constants: ticker symbol + display name
  const enc = new TextEncoder();
  patched = update_constants(patched, enc.encode(symbol), enc.encode("TMPL"), "Vector(U8)");
  patched = update_constants(patched, enc.encode(name), enc.encode("Template Credits"), "Vector(U8)");

  // Build the publish transaction
  const moduleB64 = btoa(String.fromCharCode(...patched));

  const tx = new Transaction();
  const [upgradeCap] = tx.publish({
    modules: [moduleB64],
    dependencies: COIN_TEMPLATE_DEPENDENCIES,
  });

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
