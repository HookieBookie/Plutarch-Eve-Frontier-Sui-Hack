import { useQuery } from "@tanstack/react-query";
import { executeGraphQLQuery } from "@evefrontier/dapp-kit";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CharacterData {
  /** Sui object ID of the Character */
  objectId: string;
  /** In-game character name */
  name: string;
  /** Tribe ID the character belongs to */
  tribeId: number;
  /** Tribe display name (from World API) */
  tribeName: string | null;
  /** Wallet address stored on-chain (character_address) */
  characterAddress: string;
  /** Numeric item_id from the key field */
  characterId: number;
  /** OwnerCap ID — used as the key for this player's ephemeral inventory on SSUs */
  ownerCapId: string;
}

// ---------------------------------------------------------------------------
// GraphQL – PlayerProfile → Character traversal
// ---------------------------------------------------------------------------

const PLAYER_PROFILE_TYPE = `${import.meta.env.VITE_EVE_WORLD_PACKAGE_ID}::character::PlayerProfile`;

const GET_CHARACTER_VIA_PROFILE = `
  query GetCharacterViaProfile(
    $walletAddress: SuiAddress!
    $profileType: String!
  ) {
    address(address: $walletAddress) {
      objects(filter: { type: $profileType }, first: 1) {
        nodes {
          contents {
            json
            extract(path: "character_id") {
              asAddress {
                asObject {
                  asMoveObject {
                    contents { json }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

// ---------------------------------------------------------------------------
// World API tribe lookup
// ---------------------------------------------------------------------------

import { WORLD_API } from "../config";

async function fetchTribeName(tribeId: number): Promise<string | null> {
  if (!WORLD_API) return null;
  try {
    const res = await fetch(`${WORLD_API}/v2/tribes/${tribeId}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.name ?? null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Fetcher (exported so PersonnelTab can do one-off lookups)
// ---------------------------------------------------------------------------

export async function fetchCharacter(
  walletAddress: string,
): Promise<CharacterData | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await executeGraphQLQuery<any>(GET_CHARACTER_VIA_PROFILE, {
      walletAddress,
      profileType: PLAYER_PROFILE_TYPE,
    });

    const node = result.data?.address?.objects?.nodes?.[0];
    const charJson =
      node?.contents?.extract?.asAddress?.asObject?.asMoveObject?.contents?.json;

    if (!charJson) return null;

    const tribeId =
      typeof charJson.tribe_id === "string"
        ? parseInt(charJson.tribe_id, 10)
        : Number(charJson.tribe_id ?? 0);

    const tribeName = await fetchTribeName(tribeId);

    return {
      objectId: charJson.id ?? "",
      name: charJson.metadata?.name ?? "Unknown",
      tribeId,
      tribeName,
      characterAddress: charJson.character_address ?? walletAddress,
      characterId:
        typeof charJson.key?.item_id === "string"
          ? parseInt(charJson.key.item_id, 10)
          : Number(charJson.key?.item_id ?? 0),
      ownerCapId: (charJson.owner_cap_id as string) ?? "",
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// React hook
// ---------------------------------------------------------------------------

/**
 * Fetches the EVE Frontier character associated with the connected wallet.
 * Returns character name, tribe ID, and on-chain address.
 */
export function useCharacter(walletAddress: string | undefined) {
  return useQuery({
    queryKey: ["eve-character", walletAddress],
    queryFn: () => fetchCharacter(walletAddress!),
    enabled: !!walletAddress,
    staleTime: 10_000, // refetch tribe/character data frequently (tribe changes)
    refetchOnMount: "always",
    retry: 1,
  });
}
