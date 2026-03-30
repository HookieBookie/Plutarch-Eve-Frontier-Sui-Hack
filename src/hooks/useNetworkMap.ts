import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// ── Types ──

export type WaypointType = "warp" | "smart_gate" | "jump_gate" | "ship_jump";
export type LinkType = "route" | "data";
export type MapVisibility = "tribal" | "public" | "external";

export interface MapNode {
  id: string;
  ssuId: string;
  tribeId: string;
  label: string;
  mapX: number;
  mapY: number;
  visibility: MapVisibility;
  addedBy: string;
  solarSystemName?: string;
  solarSystemId?: string;
  pNum?: string;
  lNum?: string;
}

export interface MapWaypoint {
  waypointType: WaypointType;
  fromSystem: string;
  toSystem: string;
  fromSystemId?: string;
  toSystemId?: string;
  fromLpoint: string;
  toLpoint: string;
  distance?: string;
}

export interface MapLink {
  id: string;
  tribeId: string;
  fromNodeId: string;
  toNodeId: string;
  linkType: LinkType;
  createdBy: string;
  waypoints: MapWaypoint[];
  dataShares: string[];
  rawRoute?: string;
}

export interface NetworkMapData {
  nodes: MapNode[];
  links: MapLink[];
}

const WAYPOINT_LABELS: Record<WaypointType, string> = {
  warp: "Warp",
  smart_gate: "Smart Gate",
  jump_gate: "Jump Gate",
  ship_jump: "Ship Jump",
};

export function waypointLabel(type: WaypointType): string {
  return WAYPOINT_LABELS[type] ?? type;
}

// ── Data hook ──

function mapKey(tribeId: string) {
  return ["network-map", tribeId];
}

async function fetchMap(tribeId: string): Promise<NetworkMapData> {
  const res = await fetch(`/api/network-map?tribeId=${encodeURIComponent(tribeId)}`);
  if (!res.ok) throw new Error("Failed to load network map");
  return res.json();
}

export function useNetworkMap(tribeId: string) {
  const qc = useQueryClient();
  const key = mapKey(tribeId);

  const query = useQuery<NetworkMapData>({
    queryKey: key,
    queryFn: () => fetchMap(tribeId),
    enabled: !!tribeId,
    staleTime: 5_000,
  });

  const upsertNode = useMutation({
    mutationFn: async (node: MapNode) => {
      const res = await fetch(`/api/network-map?tribeId=${encodeURIComponent(tribeId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "upsert-node", ...node }),
      });
      if (!res.ok) throw new Error("Failed to save node");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const deleteNode = useMutation({
    mutationFn: async (nodeId: string) => {
      const res = await fetch(`/api/network-map?tribeId=${encodeURIComponent(tribeId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-node", nodeId }),
      });
      if (!res.ok) throw new Error("Failed to delete node");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const createLink = useMutation({
    mutationFn: async (params: {
      id: string;
      fromNodeId: string;
      toNodeId: string;
      linkType: LinkType;
      createdBy: string;
      waypoints: MapWaypoint[];
      dataShares: string[];
      rawRoute?: string;
    }) => {
      const res = await fetch(`/api/network-map?tribeId=${encodeURIComponent(tribeId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "create-link", ...params }),
      });
      if (!res.ok) throw new Error("Failed to create link");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  const deleteLink = useMutation({
    mutationFn: async (linkId: string) => {
      const res = await fetch(`/api/network-map?tribeId=${encodeURIComponent(tribeId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete-link", linkId }),
      });
      if (!res.ok) throw new Error("Failed to delete link");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });

  return {
    nodes: query.data?.nodes ?? [],
    links: query.data?.links ?? [],
    loading: query.isLoading,
    refetch: query.refetch,
    upsertNode,
    deleteNode,
    createLink,
    deleteLink,
  };
}
