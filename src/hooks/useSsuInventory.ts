import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  getAssemblyWithOwner,
  getObjectId,
} from "@evefrontier/dapp-kit";
import { TYPE_ID_NAMES } from "../data/supplyChain";

/** Minimal inventory item shape (matches SDK InventoryItem). */
export interface InventoryItem {
  name: string;
  type_id: number;
  quantity: number;
  item_id: string;
}

export interface SsuInventory {
  /** The resolved Sui object ID (assembly address) for this SSU. */
  assemblyId: string;
  /** On-chain name given to this SSU by its owner (e.g. "Plutarch HQ"). */
  ssuName: string | null;
  /** Sui address of the SSU owner (from the on-chain character data). */
  ownerId: string | null;
  /** The SSU owner's OwnerCap ID (= inventory_keys[0], the main inventory key). */
  ownerCapId: string | null;
  /** Items in the SSU's main (owner-controlled) inventory. */
  mainItems: InventoryItem[];
  /** Items in the SSU's open storage (inventory_keys[1]). */
  openStorageItems: InventoryItem[];
  /** Ephemeral inventories keyed by OwnerCap ID (inventory_keys[2+]). */
  ephemeralByOwner: Map<string, InventoryItem[]>;
  /** All ephemeral items flat (excludes open storage). */
  allEphemeral: InventoryItem[];
}

import { EVE_TENANT } from "../config";

/**
 * Resolve the tenant dynamically:
 * 1. URL query param ?tenant=
 * 2. Fallback to EVE_TENANT from config (env-driven)
 */
function resolveTenant(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get("tenant")?.trim() || EVE_TENANT;
}

/** Resolve the SSU's Sui object ID from a game item_id or 0x address. */
export async function resolveSsuObjectId(ssuId: string): Promise<string> {
  if (ssuId.startsWith("0x")) return ssuId;
  return getObjectId(ssuId, resolveTenant());
}

/* ── Item name enrichment ── */

/* ── Extended item-name catalog ── */

/** Lazily loaded catalog from /item-types.json (390+ items with human-readable names). */
let _extendedNames: Map<number, string> | null = null;
const _loadPromise: Promise<void> = fetch("/item-types.json")
  .then((r) => r.json())
  .then((items: { id: number; name: string }[]) => {
    _extendedNames = new Map(items.map((i) => [i.id, i.name]));
  })
  .catch(() => { _extendedNames = new Map(); });

/** Preload the extended catalog so enrichItems has it ready. */
export { _loadPromise as itemCatalogReady };

/** Look up a human-readable name for a type_id, checking supply-chain map first, then the full catalog. */
function resolveItemName(typeId: number): string {
  return TYPE_ID_NAMES.get(typeId) ?? _extendedNames?.get(typeId) ?? "";
}

/** Enrich an array of inventory items with human-readable names from local data. */
function enrichItems(items: InventoryItem[]): InventoryItem[] {
  return items.map((item) => {
    if (item.name) return item;
    const name = item.type_id ? resolveItemName(item.type_id) : "";
    return name ? { ...item, name } : item;
  });
}

/** Normalize a Sui address/ID to lowercase for consistent map lookups. */
function normalizeId(id: string): string {
  return id.toLowerCase();
}

/**
 * Parse raw on-chain ItemEntry into our InventoryItem shape.
 * Sui GraphQL serializes u64 fields as JSON strings — we coerce to numbers.
 */
function parseRawItem(raw: Record<string, unknown>): InventoryItem {
  if (!raw) return { type_id: 0, quantity: 0, item_id: "", name: "" };
  return {
    type_id: Number(raw.type_id ?? 0),
    quantity: Number(raw.quantity ?? 0),
    item_id: String(raw.item_id ?? ""),
    name: String(raw.name ?? ""),
  };
}

/** Extract inventory items from a dynamic field's parsed JSON (Field<ID, Inventory>). */
function extractItemsFromField(fieldJson: Record<string, unknown> | undefined): InventoryItem[] {
  if (!fieldJson) return [];
  const inv = fieldJson as { value?: { items?: { contents?: Array<{ key: string; value: Record<string, unknown> }> } } };
  return (inv?.value?.items?.contents ?? []).map((entry) => parseRawItem(entry.value));
}

async function fetchSsuInventory(ssuId: string): Promise<SsuInventory> {
  // Ensure the extended name catalog is loaded before enriching items
  await _loadPromise;
  const objectId = await resolveSsuObjectId(ssuId);
  const { moveObject, assemblyOwner: character } = await getAssemblyWithOwner(objectId);

  if (!moveObject) {
    return { assemblyId: objectId, ssuName: null, ownerId: null, ownerCapId: null, mainItems: [], openStorageItems: [], ephemeralByOwner: new Map(), allEphemeral: [] };
  }

  const ownerId: string | null = (character as { address?: string } | null)?.address ?? null;
  const rawJson = moveObject.contents?.json as Record<string, unknown> | undefined;
  const ssuName: string | null = (rawJson?.name as string) || null;
  const inventoryKeys: string[] = (rawJson?.inventory_keys as string[]) ?? [];

  // Build a map of dynamic fields keyed by normalized ID for reliable lookups
  const dynamicFields = new Map<string, Record<string, unknown>>();
  for (const field of moveObject.dynamicFields?.nodes ?? []) {
    const fieldName = typeof field.name.json === "string"
      ? field.name.json
      : JSON.stringify(field.name.json);
    dynamicFields.set(normalizeId(fieldName), field.contents.json as Record<string, unknown>);
  }

  // Parse main inventory from the first inventory key (SSU owner's cap)
  let mainItems: InventoryItem[] = [];
  if (inventoryKeys.length > 0) {
    mainItems = enrichItems(extractItemsFromField(dynamicFields.get(normalizeId(inventoryKeys[0]))));
  }

  // Parse open storage from inventory_keys[1]
  // inventory_keys layout: [ssu_owner_cap, open_storage_key, player1_cap, ...]
  let openStorageItems: InventoryItem[] = [];
  if (inventoryKeys.length > 1) {
    openStorageItems = enrichItems(extractItemsFromField(dynamicFields.get(normalizeId(inventoryKeys[1]))));
  }

  // Parse player ephemeral inventories from remaining keys (index 2+).
  const ephemeralByOwner = new Map<string, InventoryItem[]>();
  const allEphemeral: InventoryItem[] = [];

  for (let i = 2; i < inventoryKeys.length; i++) {
    const key = normalizeId(inventoryKeys[i]);
    const items = enrichItems(extractItemsFromField(dynamicFields.get(key)));
    if (items.length > 0) {
      ephemeralByOwner.set(key, items);
      allEphemeral.push(...items);
    }
  }

  const ownerCapId: string | null = (rawJson?.owner_cap_id as string) ?? inventoryKeys[0] ?? null;

  console.log("[SSU] inventory:", inventoryKeys.length, "keys | main:", mainItems.length, "items | ephemeral:", allEphemeral.length, "items from", ephemeralByOwner.size, "slots");
  console.log("[SSU] inventoryKeys:", inventoryKeys.map(normalizeId));
  console.log("[SSU] dynamicField keys:", [...dynamicFields.keys()]);

  return { assemblyId: objectId, ssuName, ownerId, ownerCapId, mainItems, openStorageItems, ephemeralByOwner, allEphemeral };
}

/**
 * Check if the SSU has a given item type with at least `minQty` in any inventory.
 */
export function hasItem(
  inventory: SsuInventory,
  typeId: number,
  minQty: number,
): boolean {
  for (const item of inventory.mainItems) {
    if (item.type_id === typeId && item.quantity >= minQty) return true;
  }
  for (const item of inventory.allEphemeral) {
    if (item.type_id === typeId && item.quantity >= minQty) return true;
  }
  return false;
}

/** Check a specific item list for a type_id match. */
export function hasItemInList(
  items: InventoryItem[],
  typeId: number,
  minQty: number,
): boolean {
  return items.some((i) => i.type_id === typeId && i.quantity >= minQty);
}

/**
 * Check if the SSU has a given item by name (case-insensitive, singular match).
 */
export function hasItemByName(
  inventory: SsuInventory,
  name: string,
  minQty: number,
): boolean {
  const normalise = (s: string) => s.toLowerCase().replace(/s$/, "");
  const target = normalise(name);
  for (const item of [...inventory.mainItems, ...inventory.allEphemeral]) {
    if (item.name && normalise(item.name) === target && item.quantity >= minQty) return true;
  }
  return false;
}

/** Check a specific item list for a name match. */
export function hasItemByNameInList(
  items: InventoryItem[],
  name: string,
  minQty: number,
): boolean {
  const normalise = (s: string) => s.toLowerCase().replace(/s$/, "");
  const target = normalise(name);
  return items.some((i) => i.name && normalise(i.name) === target && i.quantity >= minQty);
}

/** Find the total quantity of a matching item in a list (by typeId or name). */
export function findItemQuantity(
  items: InventoryItem[],
  typeId: number | undefined,
  name: string | null,
): number {
  const normalise = (s: string) => s.toLowerCase().replace(/s$/, "");
  const target = name ? normalise(name) : null;
  let total = 0;
  for (const item of items) {
    // Coerce type_id/quantity — Sui GraphQL may serialize u64 as JSON strings
    const tid = Number(item.type_id);
    const qty = Number(item.quantity);
    if (typeId && typeId > 0 && tid === typeId) {
      total += qty;
    } else if (target && item.name && normalise(item.name) === target) {
      total += qty;
    }
  }
  return total;
}

/**
 * Extract the core item name from a mission description.
 * Mission descriptions look like:
 *   "Gather 3,150 Tholin Aggregates"
 *   "Manufacture Carbon Weaves: 1 job(s), need 3,150 Tholin Aggregates"
 *   "Refine 40 Feldspar Crystals → 10 Hydrocarbon Residue (2 jobs)"
 *   "Build 10 Carbon Weaves"
 *
 * For GATHER: returns the material name after the number.
 * For REFINE: returns the input material (before →).
 * For INDUSTRY: returns the input material (after "need N").
 * For CONSTRUCT: returns the component name after the number.
 */
export function extractItemName(description: string): string | null {
  // "Gather 3,150 Tholin Aggregates" → "Tholin Aggregates"
  let m = description.match(/^(?:\[Alt\]\s*)?Gather\s+[\d,]+\s+(.+)$/i);
  if (m) return m[1].trim();

  // "Refine 40 Feldspar Crystals → ..." → "Feldspar Crystals"
  m = description.match(/^(?:\[Alt\]\s*)?Refine\s+[\d,]+\s+(.+?)\s*→/i);
  if (m) return m[1].trim();

  // "Manufacture …: N job(s), need 3,150 Tholin Aggregates" → "Tholin Aggregates"
  m = description.match(/need\s+[\d,]+\s+(.+)$/i);
  if (m) return m[1].trim();

  // "Build 10 Carbon Weaves" → "Carbon Weaves"
  m = description.match(/^(?:\[Alt\]\s*)?Build\s+[\d,]+\s+(.+)$/i);
  if (m) return m[1].trim();

  // Plain format: "2,400 Feldspar Crystals" or "10 Carbon Weaves"
  m = description.match(/^[\d,]+\s+(.+)$/i);
  if (m) return m[1].trim();

  return null;
}

/** Fetch SSU inventory. Refetches every 15s. */
export function useSsuInventory(ssuId: string | undefined) {
  return useQuery({
    queryKey: ["ssu-inventory", ssuId],
    queryFn: () => fetchSsuInventory(ssuId!),
    enabled: !!ssuId,
    refetchInterval: 15_000,
    retry: 1,
  });
}

/** Fetch only the on-chain name for a single SSU. */
async function fetchSsuOnChainName(ssuId: string): Promise<string | null> {
  const objectId = await resolveSsuObjectId(ssuId);
  const { moveObject } = await getAssemblyWithOwner(objectId);
  if (!moveObject) return null;
  const rawJson = moveObject.contents?.json as Record<string, unknown> | undefined;
  return (rawJson?.name as string) || null;
}

/**
 * Fetch on-chain names for a batch of SSU IDs.
 * Returns a Map<ssuId, name> for SSUs that have a name set.
 */
async function fetchSsuOnChainNames(ssuIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  await Promise.all(
    ssuIds.map(async (ssuId) => {
      try {
        const name = await fetchSsuOnChainName(ssuId);
        if (name) map.set(ssuId, name);
      } catch { /* ignore individual failures */ }
    }),
  );
  return map;
}

/** Hook to fetch on-chain names for multiple SSU IDs. Cached for 5 minutes. */
export function useSsuOnChainNames(ssuIds: string[]) {
  const key = useMemo(() => JSON.stringify([...ssuIds].sort()), [ssuIds]);
  return useQuery({
    queryKey: ["ssu-on-chain-names", key],
    queryFn: () => fetchSsuOnChainNames(ssuIds),
    enabled: ssuIds.length > 0,
    staleTime: 5 * 60_000,
  });
}
