import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useGoals } from "../context/GoalContext";

export interface LocationRequest {
  id: number;
  ssuId: string;
  tribeId: string;
  requesterAddress: string;
  requesterName: string;
  requesterSsuId: string;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

export function useLocationRequests(status?: string) {
  const { ssuId, tribeId } = useGoals();
  const queryClient = useQueryClient();

  const query = useQuery<LocationRequest[]>({
    queryKey: ["location-requests", ssuId, tribeId, status],
    queryFn: async () => {
      const params = new URLSearchParams({ ssuId, tribeId });
      if (status) params.set("status", status);
      const res = await fetch(`/api/location-requests?${params}`);
      return res.json();
    },
    enabled: !!ssuId && !!tribeId,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ["location-requests", ssuId, tribeId] });
    queryClient.invalidateQueries({ queryKey: ["network-settings", ssuId, tribeId] });
  }

  const performAction = useMutation({
    mutationFn: async (payload: Record<string, unknown>) => {
      const res = await fetch(
        `/api/location-requests?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      return res.json();
    },
    onSuccess: invalidate,
  });

  return { requests: query.data ?? [], loading: query.isLoading, performAction };
}
