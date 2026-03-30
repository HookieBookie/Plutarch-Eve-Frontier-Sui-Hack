/**
 * On-chain ephemeral storage transfer hooks.
 *
 * These hooks call the storage_unit_extension contract on Sui to atomically
 * move items between ephemeral/main inventories on an SSU.
 *
 * All OwnerCaps in EVE Frontier live inside the Character object and must be
 * borrowed via `character::borrow_owner_cap<T>` and returned via
 * `access::return_owner_cap_to_object<T>` within the same programmable
 * transaction block.
 *
 * - useContribute: ephemeral → main (mission progression)
 * - useTrade: seller ephemeral → buyer ephemeral (marketplace)
 * - useDistribute: main → target ephemeral (wing supply claiming)
 * - useAuthorizeExtension: one-time SSU extension authorization
 */
import { useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { useDAppKit, useCurrentAccount } from "@mysten/dapp-kit-react";
import { EXTENSION_PACKAGE_ID, WORLD_PACKAGE_ID } from "../config";
import { friendlyTxError } from "../utils/friendlyTxError";
import { resolveSsuObjectId } from "./useSsuInventory";

const EXT = `${EXTENSION_PACKAGE_ID}::storage_unit_extension`;

/** Resolve the world package ID from config / env. */
function worldPkg(): string {
  return WORLD_PACKAGE_ID || (import.meta.env.VITE_EVE_WORLD_PACKAGE_ID as string) || "";
}

interface TxResult {
  pending: boolean;
  error: string | null;
  digest: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// useContribute — ephemeral → main (mission progression)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Move items from the caller's ephemeral inventory into the SSU's main
 * inventory. Borrows OwnerCap<Character> from the Character, calls contribute,
 * then returns the cap — all in one PTB.
 *
 * @param ssuId — SSU game item_id or Sui object ID
 */
export function useContribute(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function contribute(
    characterId: string,
    ownerCapId: string,
    typeId: number,
    quantity: number,
  ): Promise<boolean> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return false;
    }
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      // Step 1: Borrow OwnerCap<Character> from Character
      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::character::Character`],
        arguments: [
          tx.object(characterId),       // &mut Character (shared)
          tx.object(ownerCapId),        // Receiving<OwnerCap<Character>>
        ],
      });

      // Step 2: contribute(storage_unit, character, owner_cap, type_id, quantity)
      tx.moveCall({
        target: `${EXT}::contribute`,
        arguments: [
          tx.object(ssuObjectId),       // &mut StorageUnit
          tx.object(characterId),       // &Character
          borrowedCap,                  // &OwnerCap<Character>
          tx.pure.u64(typeId),          // type_id
          tx.pure.u32(quantity),        // quantity
        ],
      });

      // Step 3: Return OwnerCap<Character> back to Character
      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::character::Character`],
        arguments: [
          borrowedCap,                  // OwnerCap<Character> (by value)
          receipt,                      // ReturnOwnerCapReceipt
          tx.pure.address(characterId), // owner_id (Character object address)
        ],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }
      setState({ pending: false, error: "Transaction failed on-chain", digest: null });
      return false;
    } catch (e: unknown) {
      setState({ pending: false, error: friendlyTxError(e), digest: null });
      return false;
    }
  }

  return { contribute, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// useClaim — SSU main → caller's ephemeral (wing supply claiming)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Move items from the SSU main inventory into the caller's ephemeral inventory.
 * The reverse of `contribute`. Borrows the caller's OwnerCap<Character> via the
 * same borrow/return pattern.
 *
 * @param ssuId — SSU game item_id or Sui object ID
 */
export function useClaim(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function claim(
    characterId: string,
    ownerCapId: string,
    typeId: number,
    quantity: number,
  ): Promise<string | null> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return null;
    }
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      // Step 1: Borrow OwnerCap<Character> from Character
      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::character::Character`],
        arguments: [
          tx.object(characterId),       // &mut Character (shared)
          tx.object(ownerCapId),        // Receiving<OwnerCap<Character>>
        ],
      });

      // Step 2: claim_supply(storage_unit, character, owner_cap, type_id, quantity)
      tx.moveCall({
        target: `${EXT}::claim_supply`,
        arguments: [
          tx.object(ssuObjectId),       // &mut StorageUnit
          tx.object(characterId),       // &Character
          borrowedCap,                  // &OwnerCap<Character>
          tx.pure.u64(typeId),          // type_id
          tx.pure.u32(quantity),        // quantity
        ],
      });

      // Step 3: Return OwnerCap<Character> back to Character
      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::character::Character`],
        arguments: [
          borrowedCap,                  // OwnerCap<Character> (by value)
          receipt,                      // ReturnOwnerCapReceipt
          tx.pure.address(characterId), // owner_id (Character object address)
        ],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        const txDigest = result.Transaction.digest;
        setState({ pending: false, error: null, digest: txDigest });
        return txDigest;
      }
      const msg = "Transaction failed on-chain";
      setState({ pending: false, error: msg, digest: null });
      throw new Error(msg);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : friendlyTxError(e);
      setState({ pending: false, error: msg, digest: null });
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  return { claim, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// useClaimBatch — batch multiple main → ephemeral claims in a single PTB
// ─────────────────────────────────────────────────────────────────────────────

export function useClaimBatch(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function claimBatch(
    characterId: string,
    ownerCapId: string,
    items: { typeId: number; quantity: number }[],
  ): Promise<string | null> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return null;
    }
    if (items.length === 0) return "noop";
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::character::Character`],
        arguments: [tx.object(characterId), tx.object(ownerCapId)],
      });

      for (const item of items) {
        tx.moveCall({
          target: `${EXT}::claim_supply`,
          arguments: [
            tx.object(ssuObjectId),
            tx.object(characterId),
            borrowedCap,
            tx.pure.u64(item.typeId),
            tx.pure.u32(item.quantity),
          ],
        });
      }

      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::character::Character`],
        arguments: [borrowedCap, receipt, tx.pure.address(characterId)],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        const txDigest = result.Transaction.digest;
        setState({ pending: false, error: null, digest: txDigest });
        return txDigest;
      }
      const msg = "Transaction failed on-chain";
      setState({ pending: false, error: msg, digest: null });
      throw new Error(msg);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : friendlyTxError(e);
      setState({ pending: false, error: msg, digest: null });
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  return { claimBatch, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// useTrade — seller ephemeral → buyer ephemeral (marketplace)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Atomically move items from the seller's ephemeral inventory to the buyer's
 * ephemeral inventory. Borrows the seller's OwnerCap<Character> via the same
 * borrow/return pattern.
 *
 * @param ssuId — SSU game item_id or Sui object ID
 */
export function useTrade(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function trade(
    sellerCharacterId: string,
    sellerCapId: string,
    buyerCharacterId: string,
    typeId: number,
    quantity: number,
  ): Promise<boolean> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return false;
    }
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      // Step 1: Borrow seller's OwnerCap<Character>
      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::character::Character`],
        arguments: [
          tx.object(sellerCharacterId),  // &mut Character (seller, shared)
          tx.object(sellerCapId),        // Receiving<OwnerCap<Character>>
        ],
      });

      // Step 2: trade(storage_unit, seller_character, seller_cap, buyer_character, type_id, quantity)
      tx.moveCall({
        target: `${EXT}::trade`,
        arguments: [
          tx.object(ssuObjectId),         // &mut StorageUnit
          tx.object(sellerCharacterId),   // &Character (seller)
          borrowedCap,                    // &OwnerCap<Character> (seller)
          tx.object(buyerCharacterId),    // &Character (buyer)
          tx.pure.u64(typeId),            // type_id
          tx.pure.u32(quantity),          // quantity
        ],
      });

      // Step 3: Return OwnerCap<Character> back to seller's Character
      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::character::Character`],
        arguments: [
          borrowedCap,                           // OwnerCap<Character>
          receipt,                               // ReturnOwnerCapReceipt
          tx.pure.address(sellerCharacterId),    // owner_id
        ],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }
      setState({ pending: false, error: "Transaction failed on-chain", digest: null });
      return false;
    } catch (e: unknown) {
      setState({ pending: false, error: friendlyTxError(e), digest: null });
      return false;
    }
  }

  return { trade, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// useDistribute — main → target ephemeral (wing supply claiming)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Move items from the SSU main inventory to a target player's ephemeral
 * inventory. Borrows OwnerCap<StorageUnit> from the caller's Character since
 * the cap lives inside the Character object.
 *
 * @param ssuId — SSU game item_id or Sui object ID
 */
export function useDistribute(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function distribute(
    ssuOwnerCapId: string,
    characterId: string,
    targetCharacterId: string,
    typeId: number,
    quantity: number,
  ): Promise<boolean> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return false;
    }
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      // Step 1: Borrow OwnerCap<StorageUnit> from Character
      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::storage_unit::StorageUnit`],
        arguments: [
          tx.object(characterId),        // &mut Character (shared)
          tx.object(ssuOwnerCapId),      // Receiving<OwnerCap<StorageUnit>>
        ],
      });

      // Step 2: distribute(storage_unit, ssu_owner_cap, character, target_character, type_id, quantity)
      tx.moveCall({
        target: `${EXT}::distribute`,
        arguments: [
          tx.object(ssuObjectId),          // &mut StorageUnit
          borrowedCap,                     // &OwnerCap<StorageUnit>
          tx.object(characterId),          // &Character (caller)
          tx.object(targetCharacterId),    // &Character (recipient)
          tx.pure.u64(typeId),             // type_id
          tx.pure.u32(quantity),           // quantity
        ],
      });

      // Step 3: Return OwnerCap<StorageUnit> back to Character
      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::storage_unit::StorageUnit`],
        arguments: [
          borrowedCap,                  // OwnerCap<StorageUnit>
          receipt,                      // ReturnOwnerCapReceipt
          tx.pure.address(characterId), // owner_id
        ],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }
      setState({ pending: false, error: "Transaction failed on-chain", digest: null });
      return false;
    } catch (e: unknown) {
      setState({ pending: false, error: friendlyTxError(e), digest: null });
      return false;
    }
  }

  return { distribute, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// useAuthorizeExtension — SSU owner authorizes TribeAuth on their SSU
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SSU owner calls `storage_unit::authorize_extension<TribeAuth>()` to
 * permit the storage_unit_extension contract to manage their SSU's inventories.
 *
 * Borrows OwnerCap<StorageUnit> from the Character, authorizes, returns the cap.
 *
 * @param ssuId — SSU game item_id or Sui object ID
 */
export function useAuthorizeExtension(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function authorize(
    ssuOwnerCapId: string,
    characterId: string,
  ): Promise<boolean> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return false;
    }
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      // Step 1: Borrow OwnerCap<StorageUnit> from Character
      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::storage_unit::StorageUnit`],
        arguments: [
          tx.object(characterId),       // &mut Character (shared)
          tx.object(ssuOwnerCapId),     // Receiving<OwnerCap<StorageUnit>>
        ],
      });

      // Step 2: authorize_extension<TribeAuth>(storage_unit, owner_cap)
      tx.moveCall({
        target: `${W}::storage_unit::authorize_extension`,
        typeArguments: [`${EXTENSION_PACKAGE_ID}::storage_unit_extension::TribeAuth`],
        arguments: [
          tx.object(ssuObjectId),       // &mut StorageUnit
          borrowedCap,                  // &OwnerCap<StorageUnit>
        ],
      });

      // Step 3: Return OwnerCap<StorageUnit> back to Character
      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::storage_unit::StorageUnit`],
        arguments: [
          borrowedCap,                  // OwnerCap<StorageUnit>
          receipt,                      // ReturnOwnerCapReceipt
          tx.pure.address(characterId), // owner_id
        ],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }
      setState({ pending: false, error: "Transaction failed on-chain", digest: null });
      return false;
    } catch (e: unknown) {
      setState({ pending: false, error: friendlyTxError(e), digest: null });
      return false;
    }
  }

  return { authorize, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// useEscrowFromEphemeral — ephemeral → open storage (non-owner sell escrow)
// ─────────────────────────────────────────────────────────────────────────────

export function useEscrowFromEphemeral(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function escrow(
    characterId: string,
    ownerCapId: string,
    typeId: number,
    quantity: number,
  ): Promise<boolean> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return false;
    }
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::character::Character`],
        arguments: [tx.object(characterId), tx.object(ownerCapId)],
      });

      tx.moveCall({
        target: `${EXT}::escrow_from_ephemeral`,
        arguments: [
          tx.object(ssuObjectId),
          tx.object(characterId),
          borrowedCap,
          tx.pure.u64(typeId),
          tx.pure.u32(quantity),
        ],
      });

      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::character::Character`],
        arguments: [borrowedCap, receipt, tx.pure.address(characterId)],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }
      const msg = "Transaction failed on-chain";
      setState({ pending: false, error: msg, digest: null });
      throw new Error(msg);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : friendlyTxError(e);
      setState({ pending: false, error: msg, digest: null });
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  return { escrow, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// useEscrowFromMain — main → open storage (SSU owner sell escrow)
// ─────────────────────────────────────────────────────────────────────────────

export function useEscrowFromMain(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function escrow(
    characterId: string,
    ownerCapId: string,
    typeId: number,
    quantity: number,
  ): Promise<boolean> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return false;
    }
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::character::Character`],
        arguments: [tx.object(characterId), tx.object(ownerCapId)],
      });

      tx.moveCall({
        target: `${EXT}::escrow_from_main`,
        arguments: [
          tx.object(ssuObjectId),
          tx.object(characterId),
          borrowedCap,
          tx.pure.u64(typeId),
          tx.pure.u32(quantity),
        ],
      });

      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::character::Character`],
        arguments: [borrowedCap, receipt, tx.pure.address(characterId)],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }
      const msg = "Transaction failed on-chain";
      setState({ pending: false, error: msg, digest: null });
      throw new Error(msg);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : friendlyTxError(e);
      setState({ pending: false, error: msg, digest: null });
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  return { escrow, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// useReleaseToEphemeral — open storage → ephemeral (cancel sell / buyer receives)
// ─────────────────────────────────────────────────────────────────────────────

export function useReleaseToEphemeral(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function release(
    characterId: string,
    ownerCapId: string,
    typeId: number,
    quantity: number,
  ): Promise<boolean> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return false;
    }
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::character::Character`],
        arguments: [tx.object(characterId), tx.object(ownerCapId)],
      });

      tx.moveCall({
        target: `${EXT}::release_to_ephemeral`,
        arguments: [
          tx.object(ssuObjectId),
          tx.object(characterId),
          borrowedCap,
          tx.pure.u64(typeId),
          tx.pure.u32(quantity),
        ],
      });

      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::character::Character`],
        arguments: [borrowedCap, receipt, tx.pure.address(characterId)],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }
      const msg = "Transaction failed on-chain";
      setState({ pending: false, error: msg, digest: null });
      throw new Error(msg);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : friendlyTxError(e);
      setState({ pending: false, error: msg, digest: null });
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  return { release, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// useReleaseToMain — open storage → main (SSU owner cancel sell)
// ─────────────────────────────────────────────────────────────────────────────

export function useReleaseToMain(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function release(
    characterId: string,
    ownerCapId: string,
    typeId: number,
    quantity: number,
  ): Promise<boolean> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return false;
    }
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::character::Character`],
        arguments: [tx.object(characterId), tx.object(ownerCapId)],
      });

      tx.moveCall({
        target: `${EXT}::release_to_main`,
        arguments: [
          tx.object(ssuObjectId),
          tx.object(characterId),
          borrowedCap,
          tx.pure.u64(typeId),
          tx.pure.u32(quantity),
        ],
      });

      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::character::Character`],
        arguments: [borrowedCap, receipt, tx.pure.address(characterId)],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }
      const msg = "Transaction failed on-chain";
      setState({ pending: false, error: msg, digest: null });
      throw new Error(msg);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : friendlyTxError(e);
      setState({ pending: false, error: msg, digest: null });
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  return { release, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// useEscrowBatch — batch multiple main → open storage escrows in a single PTB
// ─────────────────────────────────────────────────────────────────────────────

interface BatchItem { typeId: number; quantity: number }

export function useEscrowBatch(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function escrowBatch(
    characterId: string,
    ownerCapId: string,
    items: BatchItem[],
  ): Promise<boolean> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return false;
    }
    if (items.length === 0) return true;
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::character::Character`],
        arguments: [tx.object(characterId), tx.object(ownerCapId)],
      });

      for (const item of items) {
        tx.moveCall({
          target: `${EXT}::escrow_from_main`,
          arguments: [
            tx.object(ssuObjectId),
            tx.object(characterId),
            borrowedCap,
            tx.pure.u64(item.typeId),
            tx.pure.u32(item.quantity),
          ],
        });
      }

      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::character::Character`],
        arguments: [borrowedCap, receipt, tx.pure.address(characterId)],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }
      const msg = "Transaction failed on-chain";
      setState({ pending: false, error: msg, digest: null });
      throw new Error(msg);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : friendlyTxError(e);
      setState({ pending: false, error: msg, digest: null });
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  return { escrowBatch, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// useEscrowEphBatch — batch multiple ephemeral → open storage escrows in a single PTB
// ─────────────────────────────────────────────────────────────────────────────

export function useEscrowEphBatch(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function escrowEphBatch(
    characterId: string,
    ownerCapId: string,
    items: BatchItem[],
  ): Promise<boolean> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return false;
    }
    if (items.length === 0) return true;
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::character::Character`],
        arguments: [tx.object(characterId), tx.object(ownerCapId)],
      });

      for (const item of items) {
        tx.moveCall({
          target: `${EXT}::escrow_from_ephemeral`,
          arguments: [
            tx.object(ssuObjectId),
            tx.object(characterId),
            borrowedCap,
            tx.pure.u64(item.typeId),
            tx.pure.u32(item.quantity),
          ],
        });
      }

      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::character::Character`],
        arguments: [borrowedCap, receipt, tx.pure.address(characterId)],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }
      const msg = "Transaction failed on-chain";
      setState({ pending: false, error: msg, digest: null });
      throw new Error(msg);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : friendlyTxError(e);
      setState({ pending: false, error: msg, digest: null });
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  return { escrowEphBatch, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// useReleaseBatch — batch multiple open storage → main releases in a single PTB
// ─────────────────────────────────────────────────────────────────────────────

export function useReleaseBatch(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function releaseBatch(
    characterId: string,
    ownerCapId: string,
    items: BatchItem[],
  ): Promise<boolean> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return false;
    }
    if (items.length === 0) return true;
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::character::Character`],
        arguments: [tx.object(characterId), tx.object(ownerCapId)],
      });

      for (const item of items) {
        tx.moveCall({
          target: `${EXT}::release_to_main`,
          arguments: [
            tx.object(ssuObjectId),
            tx.object(characterId),
            borrowedCap,
            tx.pure.u64(item.typeId),
            tx.pure.u32(item.quantity),
          ],
        });
      }

      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::character::Character`],
        arguments: [borrowedCap, receipt, tx.pure.address(characterId)],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }
      const msg = "Transaction failed on-chain";
      setState({ pending: false, error: msg, digest: null });
      throw new Error(msg);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : friendlyTxError(e);
      setState({ pending: false, error: msg, digest: null });
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  return { releaseBatch, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// useReleaseEphBatch — batch multiple open storage → ephemeral in a single PTB
// ─────────────────────────────────────────────────────────────────────────────

export function useReleaseEphBatch(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function releaseEphBatch(
    characterId: string,
    ownerCapId: string,
    items: BatchItem[],
  ): Promise<boolean> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return false;
    }
    if (items.length === 0) return true;
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::character::Character`],
        arguments: [tx.object(characterId), tx.object(ownerCapId)],
      });

      for (const item of items) {
        tx.moveCall({
          target: `${EXT}::release_to_ephemeral`,
          arguments: [
            tx.object(ssuObjectId),
            tx.object(characterId),
            borrowedCap,
            tx.pure.u64(item.typeId),
            tx.pure.u32(item.quantity),
          ],
        });
      }

      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::character::Character`],
        arguments: [borrowedCap, receipt, tx.pure.address(characterId)],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }
      const msg = "Transaction failed on-chain";
      setState({ pending: false, error: msg, digest: null });
      throw new Error(msg);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : friendlyTxError(e);
      setState({ pending: false, error: msg, digest: null });
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  return { releaseEphBatch, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// useResetStorage — move all ephemeral + open storage items back to main
// ─────────────────────────────────────────────────────────────────────────────

interface ResetItem { typeId: number; quantity: number }

export function useResetStorage(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  /**
   * Build a single PTB that:
   * 1. Contributes all owner-ephemeral items back to main
   * 2. Releases all open-storage items back to main
   */
  async function reset(
    characterId: string,
    ownerCapId: string,
    ephemeralItems: ResetItem[],
    openStorageItems: ResetItem[],
  ): Promise<boolean> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return false;
    }
    if (ephemeralItems.length === 0 && openStorageItems.length === 0) {
      setState({ pending: false, error: "Nothing to reset", digest: null });
      return false;
    }
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      // Borrow OwnerCap<Character> once
      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::character::Character`],
        arguments: [tx.object(characterId), tx.object(ownerCapId)],
      });

      // Contribute each ephemeral item back to main
      for (const item of ephemeralItems) {
        tx.moveCall({
          target: `${EXT}::contribute`,
          arguments: [
            tx.object(ssuObjectId),
            tx.object(characterId),
            borrowedCap,
            tx.pure.u64(item.typeId),
            tx.pure.u32(item.quantity),
          ],
        });
      }

      // Release each open-storage item back to main
      for (const item of openStorageItems) {
        tx.moveCall({
          target: `${EXT}::release_to_main`,
          arguments: [
            tx.object(ssuObjectId),
            tx.object(characterId),
            borrowedCap,
            tx.pure.u64(item.typeId),
            tx.pure.u32(item.quantity),
          ],
        });
      }

      // Return OwnerCap<Character>
      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::character::Character`],
        arguments: [borrowedCap, receipt, tx.pure.address(characterId)],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }
      const msg = "Transaction failed on-chain";
      setState({ pending: false, error: msg, digest: null });
      throw new Error(msg);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : friendlyTxError(e);
      setState({ pending: false, error: msg, digest: null });
      throw e instanceof Error ? e : new Error(msg);
    }
  }

  return { reset, ...state };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper: resolve a wallet address to a Character object ID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Look up a character's Sui object ID from a wallet address via GraphQL.
 * Useful for trade/distribute where the counterparty's Character object is needed.
 */
export async function resolveCharacterId(walletAddress: string): Promise<string | null> {
  const { fetchCharacter } = await import("./useCharacter");
  const char = await fetchCharacter(walletAddress);
  return char?.objectId ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// useBumpSsu — touch the SSU object to force the game client to refresh
// ─────────────────────────────────────────────────────────────────────────────

/**
 * "Bump" the SSU's Sui object version by calling update_metadata_name with the
 * current name.  This mutates the StorageUnit object (incrementing its version)
 * without changing any data, which tricks the game client into re-fetching the
 * SSU's inventory.
 *
 * Requires the caller to be the SSU owner (OwnerCap<StorageUnit> lives inside
 * their Character).
 */
export function useBumpSsu(ssuId: string | undefined) {
  const { signAndExecuteTransaction } = useDAppKit();
  const account = useCurrentAccount();
  const [state, setState] = useState<TxResult>({ pending: false, error: null, digest: null });

  async function bump(
    ssuOwnerCapId: string,
    characterId: string,
    currentName?: string,
  ): Promise<boolean> {
    if (!account || !ssuId) {
      setState({ pending: false, error: "Wallet or SSU not available", digest: null });
      return false;
    }
    setState({ pending: true, error: null, digest: null });
    try {
      const W = worldPkg();
      const ssuObjectId = await resolveSsuObjectId(ssuId);
      const tx = new Transaction();

      // Step 1: Borrow OwnerCap<StorageUnit> from Character
      const [borrowedCap, receipt] = tx.moveCall({
        target: `${W}::character::borrow_owner_cap`,
        typeArguments: [`${W}::storage_unit::StorageUnit`],
        arguments: [
          tx.object(characterId),
          tx.object(ssuOwnerCapId),
        ],
      });

      // Step 2: update_metadata_name (no-op: same name → only bumps object version)
      tx.moveCall({
        target: `${W}::storage_unit::update_metadata_name`,
        arguments: [
          tx.object(ssuObjectId),
          borrowedCap,
          tx.pure.string(currentName ?? ""),
        ],
      });

      // Step 3: Return OwnerCap<StorageUnit> back to Character
      tx.moveCall({
        target: `${W}::access::return_owner_cap_to_object`,
        typeArguments: [`${W}::storage_unit::StorageUnit`],
        arguments: [
          borrowedCap,
          receipt,
          tx.pure.address(characterId),
        ],
      });

      const result = await signAndExecuteTransaction({ transaction: tx });
      if (result.$kind === "Transaction") {
        setState({ pending: false, error: null, digest: result.Transaction.digest });
        return true;
      }
      setState({ pending: false, error: "Transaction failed on-chain", digest: null });
      return false;
    } catch (e: unknown) {
      setState({ pending: false, error: friendlyTxError(e), digest: null });
      return false;
    }
  }

  return { bump, ...state };
}
