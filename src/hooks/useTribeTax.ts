import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface TribeSettings {
  taxBps: number; // basis points, e.g. 200 = 2%
}

async function fetchSettings(tribeId: string): Promise<TribeSettings> {
  const res = await fetch(`/api/tribe-settings?tribeId=${encodeURIComponent(tribeId)}`);
  const data = await res.json();
  return { taxBps: Number(data?.taxBps) || 0 };
}

async function saveSettings(tribeId: string, settings: TribeSettings): Promise<void> {
  await fetch(`/api/tribe-settings?tribeId=${encodeURIComponent(tribeId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export function useTribeTax(tribeId: string | undefined) {
  const qc = useQueryClient();
  const id = tribeId ?? "0";

  const { data, isLoading } = useQuery({
    queryKey: ["tribe-settings", id],
    queryFn: () => fetchSettings(id),
    enabled: !!tribeId,
    staleTime: 60_000,
  });

  const mutation = useMutation({
    mutationFn: (taxBps: number) => saveSettings(id, { taxBps }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tribe-settings", id] }),
  });

  return {
    taxBps: data?.taxBps ?? 0,
    taxPct: (data?.taxBps ?? 0) / 100,
    loading: isLoading,
    setTaxBps: mutation.mutateAsync,
    saving: mutation.isPending,
  };
}

/** Calculate tribe tax in credits for a given total. */
export function calcTribeTax(total: number, taxBps: number): number {
  if (taxBps <= 0) return 0;
  return Math.ceil((total * taxBps) / 10_000);
}
