import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface Allocation {
  id: string;
  itemTypeId: number;
  itemName: string;
  wingId: string;
  quantity: number;
  allocatedBy: string;
  allocatedAt: number;
  packageId?: string | null;
}

interface AllocationStore {
  allocations: Allocation[];
}

async function fetchAllocations(ssuId: string, tribeId: string): Promise<Allocation[]> {
  const res = await fetch(
    `/api/allocations?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
  );
  const data: AllocationStore = await res.json();
  return Array.isArray(data?.allocations) ? data.allocations : [];
}

async function saveAllocations(ssuId: string, tribeId: string, allocations: Allocation[]): Promise<void> {
  await fetch(
    `/api/allocations?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allocations }),
    },
  );
}

export function useAllocations(ssuId: string, tribeId: string) {
  const qc = useQueryClient();
  const qk = ["allocations", ssuId, tribeId];

  const { data, isLoading } = useQuery({
    queryKey: qk,
    queryFn: () => fetchAllocations(ssuId, tribeId),
    enabled: !!ssuId && !!tribeId,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });

  const mutation = useMutation({
    mutationFn: (allocations: Allocation[]) => saveAllocations(ssuId, tribeId, allocations),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk }),
  });

  const allocations = data ?? [];

  /** Owner allocates items from SSU inventory to a wing. */
  function allocate(
    itemTypeId: number,
    itemName: string,
    wingId: string,
    quantity: number,
    allocatedBy: string,
  ) {
    // Merge into existing allocation for same item+wing if present
    const existing = allocations.find(
      (a) => a.itemTypeId === itemTypeId && a.wingId === wingId,
    );
    let updated: Allocation[];
    if (existing) {
      updated = allocations.map((a) =>
        a.id === existing.id
          ? { ...a, quantity: a.quantity + quantity, allocatedAt: Date.now() }
          : a,
      );
    } else {
      const newAlloc: Allocation = {
        id: `alloc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        itemTypeId,
        itemName,
        wingId,
        quantity,
        allocatedBy,
        allocatedAt: Date.now(),
      };
      updated = [...allocations, newAlloc];
    }
    return mutation.mutateAsync(updated);
  }

  /** Withdraw: decrease an allocation's quantity (or remove if zero). */
  function withdraw(allocationId: string, amount: number) {
    const updated = allocations
      .map((a) => {
        if (a.id !== allocationId) return a;
        const remaining = a.quantity - amount;
        return remaining > 0 ? { ...a, quantity: remaining } : null;
      })
      .filter(Boolean) as Allocation[];
    return mutation.mutateAsync(updated);
  }

  /** Allocate a whole package to a wing. */
  function allocatePackage(
    packageId: string,
    packageName: string,
    wingId: string,
    allocatedBy: string,
  ) {
    const newAlloc: Allocation = {
      id: `alloc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      itemTypeId: 0,
      itemName: `📦 ${packageName}`,
      wingId,
      quantity: 1,
      allocatedBy,
      allocatedAt: Date.now(),
      packageId,
    };
    return mutation.mutateAsync([...allocations, newAlloc]);
  }

  /** Remove a package allocation entirely. */
  function withdrawPackage(allocationId: string) {
    const updated = allocations.filter((a) => a.id !== allocationId);
    return mutation.mutateAsync(updated);
  }

  return {
    allocations,
    loading: isLoading,
    saving: mutation.isPending,
    allocate,
    withdraw,
    allocatePackage,
    withdrawPackage,
  };
}
