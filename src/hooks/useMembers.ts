import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

export interface TribeMember {
  address: string;
  name: string;
  characterId?: number;
  joinedAt: number;
}

async function fetchMembers(ssuId: string, tribeId: string): Promise<TribeMember[]> {
  const res = await fetch(
    `/api/members?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
  );
  const data = await res.json();
  return Array.isArray(data?.members) ? data.members : [];
}

async function saveMembers(ssuId: string, tribeId: string, members: TribeMember[]): Promise<void> {
  await fetch(
    `/api/members?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ members }),
    },
  );
}

export function useMembers(ssuId: string, tribeId: string) {
  const qc = useQueryClient();
  const qk = ["members", ssuId, tribeId];

  const { data, isLoading } = useQuery({
    queryKey: qk,
    queryFn: () => fetchMembers(ssuId, tribeId),
    enabled: !!ssuId,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: (members: TribeMember[]) => saveMembers(ssuId, tribeId, members),
    onSuccess: () => qc.invalidateQueries({ queryKey: qk }),
  });

  const members = data ?? [];

  function addMember(name: string, address: string, characterId?: number) {
    if (members.some((m) => m.address === address)) return Promise.resolve();
    return mutation.mutateAsync([
      ...members,
      { name, address, characterId, joinedAt: Date.now() },
    ]);
  }

  function removeMember(address: string) {
    return mutation.mutateAsync(members.filter((m) => m.address !== address));
  }

  function updateMember(address: string, patch: Partial<TribeMember>) {
    return mutation.mutateAsync(
      members.map((m) => (m.address === address ? { ...m, ...patch } : m)),
    );
  }

  return { members, loading: isLoading, saving: mutation.isPending, addMember, removeMember, updateMember };
}
