import { useQuery } from "@tanstack/react-query";

export interface TerritorySSU {
  ssuId: string;
  hubName: string;
  activatedBy: string;
  characterName: string;
  visibility: string;
  hasLocation: boolean;
  locationGranted: boolean;
  solarSystemId: string | null;
  solarSystemName: string | null;
  locationX: number | null;
  locationY: number | null;
  locationZ: number | null;
  pNum?: string;
  lNum?: string;
  isExternal?: boolean;
  isTribeMember?: boolean;
  networkNodeId?: string | null;
}

export function useTerritoryData(tribeId: string, wallet: string, ssuId?: string) {
  const query = useQuery<TerritorySSU[]>({
    queryKey: ["tribe-locations", tribeId, wallet, ssuId],
    queryFn: async () => {
      const params = new URLSearchParams({ tribeId, wallet });
      if (ssuId) params.set("ssuId", ssuId);
      const res = await fetch(`/api/tribe-locations?${params}`);
      return res.json();
    },
    enabled: !!tribeId,
  });

  return { ssus: query.data ?? [], loading: query.isLoading, refetch: query.refetch };
}

/** Euclidean distance in game units between two 3D points. */
export function distance3d(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  return Math.sqrt((bx - ax) ** 2 + (by - ay) ** 2 + (bz - az) ** 2);
}

/**
 * Convert raw game-unit distance to light-years.
 * EVE Frontier uses 1 AU ≈ 1e11 m and 1 Ly ≈ 9.461e15 m.
 * In-game coordinates are in metres, so Ly = dist / 9.461e15.
 * 
 */
const METRES_PER_LY = 9.461e15;

export function toLightYears(distMetres: number): number {
  return distMetres / METRES_PER_LY;
}

export function formatLy(ly: number): string {
  if (ly < 0.001) return `${(ly * 1000).toFixed(2)} mLy`;
  if (ly < 1) return `${ly.toFixed(3)} Ly`;
  return `${ly.toFixed(2)} Ly`;
}
