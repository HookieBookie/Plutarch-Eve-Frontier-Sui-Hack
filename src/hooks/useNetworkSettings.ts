import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGoals } from "../context/GoalContext";

export interface NetworkSettings {
  ssuId: string;
  tribeId: string;
  visibility: "private" | "public" | "tribal";
  locationPolicy: "manual" | "auto-accept" | "auto-deny" | "whitelist";
  budgetMode: "shared" | "local";
  localBudget: number;
  networkNodeId: string | null;
  blocked: Array<{ address?: string; blockedSsuId?: string }>;
  whitelist: string[];
  grants: string[];
}

export function useNetworkSettings() {
  const { ssuId, tribeId } = useGoals();
  const queryClient = useQueryClient();

  const query = useQuery<NetworkSettings>({
    queryKey: ["network-settings", ssuId, tribeId],
    queryFn: async () => {
      const res = await fetch(
        `/api/network-settings?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
      );
      return res.json();
    },
    enabled: !!ssuId && !!tribeId,
  });

  const updateSettings = useMutation({
    mutationFn: async (settings: { visibility: string; locationPolicy: string; budgetMode?: string; localBudget?: number; networkNodeId?: string }) => {
      const res = await fetch(
        `/api/network-settings?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ssuId, tribeId, ...settings }),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["network-settings", ssuId, tribeId] });
    },
  });

  return { settings: query.data, loading: query.isLoading, updateSettings };
}
