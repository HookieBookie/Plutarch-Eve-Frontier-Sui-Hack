import { useQuery } from "@tanstack/react-query";
import { ITEM_TYPE_IDS, getAllRecipes } from "../data/supplyChain";
import { itemIconUrl } from "../components/ItemIcon";
import { WORLD_API } from "../config";

export interface ItemType {
  id: number;
  name: string;
  description: string;
  mass: number;
  volume: number;
  portionSize: number;
  groupName: string;
  groupId: number;
  categoryName: string;
  categoryId: number;
  radius: number;
  iconUrl: string;
}

interface ApiTypeResponse {
  id: number;
  name: string;
  description: string;
  mass: number;
  volume: number;
  portionSize: number;
  groupName: string;
  groupId: number;
  categoryName: string;
  categoryId: number;
  radius: number;
  iconUrl: string;
}

interface ApiShipResponse {
  id: number;
  name: string;
  description: string;
  classId: number;
  className: string;
}

/** Fetch all item types from the World API (paginated). */
async function fetchFromWorldApi(): Promise<Map<number, ApiTypeResponse>> {
  const map = new Map<number, ApiTypeResponse>();
  let offset = 0;
  const limit = 1000;
  while (true) {
    const res = await fetch(`${WORLD_API}/v2/types?limit=${limit}&offset=${offset}`);
    if (!res.ok) break;
    const json = await res.json();
    const items: ApiTypeResponse[] = json.data ?? json;
    if (items.length === 0) break;
    for (const item of items) map.set(item.id, item);
    if (items.length < limit) break;
    offset += limit;
  }

  // Also fetch ships and merge them as item types
  try {
    const shipRes = await fetch(`${WORLD_API}/v2/ships?limit=1000&offset=0`);
    if (shipRes.ok) {
      const shipJson = await shipRes.json();
      const ships: ApiShipResponse[] = shipJson.data ?? shipJson;
      for (const ship of ships) {
        if (map.has(ship.id)) continue;
        map.set(ship.id, {
          id: ship.id,
          name: ship.name,
          description: ship.description,
          mass: 0,
          volume: 0,
          portionSize: 1,
          groupName: ship.className,
          groupId: ship.classId,
          categoryName: "Ship",
          categoryId: 0,
          radius: 0,
          iconUrl: "",
        });
      }
    }
  } catch { /* ships endpoint optional */ }

  return map;
}

/** Build item catalog by merging World API metadata with local supply-chain items. */
function buildCatalog(apiItems: Map<number, ApiTypeResponse>): ItemType[] {
  const all = getAllRecipes();

  // Collect every unique item name from supply-chain data
  const names = new Set<string>();
  for (const name of Object.keys(ITEM_TYPE_IDS)) names.add(name);
  for (const r of all.gather) names.add(r.item);
  for (const r of all.refining) { names.add(r.inputItem); names.add(r.outputItem); }
  for (const r of all.industry) { names.add(r.inputItem); names.add(r.outputItem); }
  for (const r of all.construction) { names.add(r.building); names.add(r.component); }

  const seen = new Set<number>();
  const items: ItemType[] = [];

  // First: add supply-chain items, enriched with API metadata where available
  let syntheticId = -1;
  for (const name of names) {
    const typeId = ITEM_TYPE_IDS[name] ?? 0;
    const api = typeId ? apiItems.get(typeId) : undefined;
    const id = typeId || syntheticId--;
    if (typeId > 0) seen.add(typeId);

    items.push({
      id,
      name: api?.name ?? name,
      description: api?.description ?? "",
      mass: api?.mass ?? 0,
      volume: api?.volume ?? 0,
      portionSize: api?.portionSize ?? 1,
      groupName: api?.groupName ?? "",
      groupId: api?.groupId ?? 0,
      categoryName: api?.categoryName ?? "",
      categoryId: api?.categoryId ?? 0,
      radius: api?.radius ?? 0,
      iconUrl: itemIconUrl(id > 0 ? id : undefined) ?? "",
    });
  }

  // Second: add any API items not already covered (discover new game items)
  for (const [typeId, api] of apiItems) {
    if (seen.has(typeId)) continue;
    items.push({
      id: typeId,
      name: api.name,
      description: api.description,
      mass: api.mass,
      volume: api.volume,
      portionSize: api.portionSize,
      groupName: api.groupName,
      groupId: api.groupId,
      categoryName: api.categoryName,
      categoryId: api.categoryId,
      radius: api.radius,
      iconUrl: itemIconUrl(typeId) ?? "",
    });
  }

  items.sort((a, b) => a.categoryName.localeCompare(b.categoryName) || a.name.localeCompare(b.name));
  return items;
}

async function fetchItemTypes(): Promise<ItemType[]> {
  try {
    const apiItems = await fetchFromWorldApi();
    return buildCatalog(apiItems);
  } catch {
    // Fallback: build from local data only
    return buildCatalog(new Map());
  }
}

/** All item types from the EVE world API, cached for the session. */
export function useItemCatalog() {
  return useQuery<ItemType[]>({
    queryKey: ["item-catalog"],
    queryFn: fetchItemTypes,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });
}

/** Derive unique categories from the catalog. */
export function getCategories(items: ItemType[]): string[] {
  const cats = new Set(items.map((i) => i.categoryName).filter(Boolean));
  return [...cats].sort();
}
