import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface OverlaySubscription {
  id: number;
  wallet: string;
  ssuId: string;
  tribeId: string;
  goalId: number;
  missionIdx: number;
  createdAt: number;
}

export function useOverlaySubscriptions(wallet: string, ssuId: string, tribeId: string) {
  return useQuery<OverlaySubscription[]>({
    queryKey: ["overlay-subscriptions", wallet, ssuId, tribeId],
    queryFn: async () => {
      if (!wallet || !ssuId || !tribeId) return [];
      const res = await fetch(
        `/api/overlay-subscriptions?wallet=${encodeURIComponent(wallet)}&ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
      );
      return res.json();
    },
    enabled: !!wallet && !!ssuId && !!tribeId,
    staleTime: 30_000,
  });
}

export function useAddOverlaySubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { wallet: string; ssuId: string; tribeId: string; goalId: number; missionIdx: number }) => {
      const res = await fetch("/api/overlay-subscriptions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["overlay-subscriptions", vars.wallet, vars.ssuId, vars.tribeId] });
    },
  });
}

export function useRemoveOverlaySubscription() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (params: { wallet: string; ssuId: string; tribeId: string; goalId: number; missionIdx: number }) => {
      const res = await fetch("/api/overlay-subscriptions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params),
      });
      return res.json();
    },
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["overlay-subscriptions", vars.wallet, vars.ssuId, vars.tribeId] });
    },
  });
}
