import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface PackageItem {
  itemTypeId: number;
  itemName: string;
  quantity: number;
  slotType: string;
}

export interface Package {
  id: string;
  ssuId: string;
  tribeId: string;
  name: string;
  shipType: string;
  fittingText: string;
  createdBy: string;
  status: string;
  marketOrderId: string | null;
  createdAt: number;
  items: PackageItem[];
}

async function fetchPackages(ssuId: string, tribeId: string): Promise<Package[]> {
  const res = await fetch(
    `/api/packages?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
  );
  const data = await res.json();
  return Array.isArray(data?.packages) ? data.packages : [];
}

export function usePackages(ssuId: string, tribeId: string) {
  const qc = useQueryClient();
  const qk = ["packages", ssuId, tribeId];

  const { data, isLoading } = useQuery({
    queryKey: qk,
    queryFn: () => fetchPackages(ssuId, tribeId),
    enabled: !!ssuId && !!tribeId,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const createMut = useMutation({
    mutationFn: async (pkg: {
      id: string;
      name: string;
      shipType: string;
      fittingText: string;
      createdBy: string;
      items: Omit<PackageItem, "id">[];
    }) => {
      const res = await fetch(
        `/api/packages?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}&action=create`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(pkg) },
      );
      if (!res.ok) throw new Error((await res.json()).error || "Failed to create package");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk }),
  });

  const deleteMut = useMutation({
    mutationFn: async (packageId: string) => {
      const res = await fetch(
        `/api/packages?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}&action=delete`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ packageId }) },
      );
      if (!res.ok) throw new Error((await res.json()).error || "Failed to delete package");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk });
      qc.invalidateQueries({ queryKey: ["market-orders"] });
    },
  });

  const listOnMarketMut = useMutation({
    mutationFn: async (args: { packageId: string; wallet: string; playerName: string; price: number }) => {
      const res = await fetch(
        `/api/packages?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}&action=list-market`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) },
      );
      if (!res.ok) throw new Error((await res.json()).error || "Failed to list on market");
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk });
      qc.invalidateQueries({ queryKey: ["market-orders"] });
    },
  });

  const updateStatusMut = useMutation({
    mutationFn: async (args: { packageId: string; status: string; marketOrderId?: string }) => {
      const res = await fetch(
        `/api/packages?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}&action=update-status`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args) },
      );
      if (!res.ok) throw new Error((await res.json()).error || "Failed to update package status");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: qk }),
  });

  return {
    packages: data ?? [],
    loading: isLoading,
    saving: createMut.isPending || deleteMut.isPending || listOnMarketMut.isPending,
    createPackage: createMut.mutateAsync,
    deletePackage: deleteMut.mutateAsync,
    listOnMarket: listOnMarketMut.mutateAsync,
    updateStatus: updateStatusMut.mutateAsync,
  };
}
