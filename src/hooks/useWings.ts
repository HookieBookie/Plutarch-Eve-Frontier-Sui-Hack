import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface Wing {
  id: string;
  name: string;
  color: string;
  symbol: string;
  memberAddresses: string[];
}

async function fetchWings(ssuId: string, tribeId: string): Promise<Wing[]> {
  const res = await fetch(
    `/api/wings?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
  );
  const data = await res.json();
  return Array.isArray(data?.wings) ? data.wings : [];
}

async function saveWings(ssuId: string, tribeId: string, wings: Wing[]): Promise<void> {
  await fetch(
    `/api/wings?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ wings }),
    },
  );
}

export function useWings(ssuId: string, tribeId: string) {
  const qc = useQueryClient();
  const qk = ["wings", ssuId, tribeId];

  const { data, isLoading } = useQuery({
    queryKey: qk,
    queryFn: () => fetchWings(ssuId, tribeId),
    enabled: !!ssuId,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (wings: Wing[]) => saveWings(ssuId, tribeId, wings),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk }),
  });

  const wings = data ?? [];

  function addWing(name: string, color: string, symbol = "⬡") {
    const id = `wing_${Date.now()}`;
    return mutation.mutateAsync([...wings, { id, name, color, symbol, memberAddresses: [] }]);
  }

  function updateWingColor(wingId: string, color: string) {
    return mutation.mutateAsync(wings.map((w) => (w.id === wingId ? { ...w, color } : w)));
  }

  function updateWingSymbol(wingId: string, symbol: string) {
    return mutation.mutateAsync(wings.map((w) => (w.id === wingId ? { ...w, symbol } : w)));
  }

  function removeWing(wingId: string) {
    return mutation.mutateAsync(wings.filter((w) => w.id !== wingId));
  }

  function renameWing(wingId: string, name: string) {
    return mutation.mutateAsync(wings.map((w) => (w.id === wingId ? { ...w, name } : w)));
  }

  function assignMember(wingId: string, address: string) {
    return mutation.mutateAsync(
      wings.map((w) => {
        if (w.id !== wingId) return w;
        if (w.memberAddresses.includes(address)) return w;
        return { ...w, memberAddresses: [...w.memberAddresses, address] };
      }),
    );
  }

  function unassignMember(wingId: string, address: string) {
    return mutation.mutateAsync(
      wings.map((w) => {
        if (w.id !== wingId) return w;
        return { ...w, memberAddresses: w.memberAddresses.filter((a) => a !== address) };
      }),
    );
  }

  return { wings, loading: isLoading, saving: mutation.isPending, addWing, removeWing, renameWing, updateWingColor, updateWingSymbol, assignMember, unassignMember };
}
