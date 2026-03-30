import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { Mission } from "../data/supplyChain";

// ── Types ──

export type ContractStatus = "open" | "accepted" | "completed" | "failed" | "expired" | "cancelled";

export interface ContractMission {
  idx: number;
  phase: string;
  tier: number;
  description: string;
  quantity: number;
  typeId: number | null;
  isAlternative: boolean;
  altReason: string | null;
  inputItem: string | null;
  completedQty: number;
}

export interface Contract {
  id: string;
  ssuId: string;
  tribeId: string;
  creatorWallet: string;
  creatorName: string;
  type: string;
  description: string;
  budget: number;
  taxPaid: number;
  visibility: string;
  postDurationMs: number;
  missionDurationMs: number;
  status: ContractStatus;
  acceptorWallet: string | null;
  acceptorName: string | null;
  acceptorDeposit: number;
  acceptedAt: number | null;
  completedAt: number | null;
  createdAt: number;
  missions: ContractMission[];
  /** Enriched for Deliver contracts */
  delivery?: {
    id: string;
    destinationSsuId: string;
    destinationLabel: string;
    items: { typeId: number; itemName: string; quantity: number }[];
    collateral: number;
    timerMs: number;
    status: string;
  } | null;
  couriers?: {
    courierWallet: string;
    courierName: string;
    itemsDeposited: { typeId: number; itemName: string; quantity: number }[];
    status: string;
  }[];
  /** Creator tribe's full coin type, e.g. "0xabc::co86::CO86" */
  creatorCoinType?: string;
}

// ── API helpers ──

async function fetchContracts(ssuId: string, tribeId: string): Promise<Contract[]> {
  const res = await fetch(
    `/api/contracts?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
  );
  const data = await res.json();
  return data?.contracts ?? [];
}

async function postContractAction(
  ssuId: string,
  tribeId: string,
  action: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(
    `/api/contracts?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}&action=${action}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error ?? "Request failed");
  }
}

// ── Context ──

interface ContractContextValue {
  contracts: Contract[];
  loading: boolean;
  refresh: () => void;
  createContract: (data: {
    id: string;
    type: string;
    description: string;
    budget: number;
    taxPaid: number;
    visibility: string;
    postDurationMs: number;
    missionDurationMs: number;
    creatorWallet: string;
    creatorName: string;
    missions: Mission[];
    /** Amount covered by on-chain tribe ticker credits (already redeemed). */
    fromOnChain?: number;
    /** Delivery-specific fields */
    deliveryItems?: { typeId: number; itemName: string; quantity: number }[];
    destinationSsuId?: string;
    destinationTribeId?: string;
    destinationLabel?: string;
    collateral?: number;
  }) => Promise<void>;
  cancelContract: (contractId: string) => Promise<void>;
  acceptContract: (contractId: string, wallet: string, playerName: string, deposit: number) => Promise<void>;
  progressMission: (contractId: string, missionIdx: number, quantity: number, typeId?: number, itemName?: string) => Promise<void>;
  failContract: (contractId: string) => Promise<void>;
  expireContract: (contractId: string) => Promise<void>;
}

const ContractCtx = createContext<ContractContextValue | null>(null);

export function ContractProvider({
  tribeId,
  ssuId,
  children,
}: {
  tribeId: string;
  ssuId: string;
  children: ReactNode;
}) {
  const [contracts, setContracts] = useState<Contract[]>([]);
  const [loading, setLoading] = useState(true);
  const ssuIdRef = useRef(ssuId);
  const tribeIdRef = useRef(tribeId);
  ssuIdRef.current = ssuId;
  tribeIdRef.current = tribeId;

  const load = useCallback(() => {
    setLoading(true);
    fetchContracts(ssuIdRef.current, tribeIdRef.current)
      .then(setContracts)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [ssuId, tribeId, load]);

  // Poll every 15s so timers stay fresh
  useEffect(() => {
    const iv = setInterval(load, 15_000);
    return () => clearInterval(iv);
  }, [load]);

  const refresh = load;

  async function createContract(data: Parameters<ContractContextValue["createContract"]>[0]) {
    const missions = data.missions.map((m, i) => ({
      idx: i,
      phase: m.phase,
      tier: m.tier,
      description: m.description,
      quantity: m.quantity,
      typeId: m.typeId ?? null,
      isAlternative: m.isAlternative ?? false,
      altReason: m.altReason ?? null,
      inputItem: m.inputItem ?? null,
      completedQty: 0,
    }));
    await postContractAction(ssuIdRef.current, tribeIdRef.current, "create", { ...data, missions });
    load();
  }

  async function cancel(contractId: string) {
    await postContractAction(ssuIdRef.current, tribeIdRef.current, "cancel", { contractId });
    load();
  }

  async function accept(contractId: string, wallet: string, playerName: string, deposit: number) {
    await postContractAction(ssuIdRef.current, tribeIdRef.current, "accept", {
      contractId,
      wallet,
      playerName,
      deposit,
    });
    load();
  }

  async function progressMission(
    contractId: string,
    missionIdx: number,
    quantity: number,
    typeId?: number,
    itemName?: string,
  ) {
    await postContractAction(ssuIdRef.current, tribeIdRef.current, "progress", {
      contractId,
      missionIdx,
      quantity,
      typeId,
      itemName,
    });
    load();
  }

  async function fail(contractId: string) {
    await postContractAction(ssuIdRef.current, tribeIdRef.current, "fail", { contractId });
    load();
  }

  async function expire(contractId: string) {
    await postContractAction(ssuIdRef.current, tribeIdRef.current, "expire", { contractId });
    load();
  }

  return (
    <ContractCtx.Provider
      value={{
        contracts,
        loading,
        refresh,
        createContract,
        cancelContract: cancel,
        acceptContract: accept,
        progressMission,
        failContract: fail,
        expireContract: expire,
      }}
    >
      {children}
    </ContractCtx.Provider>
  );
}

export function useContracts() {
  const ctx = useContext(ContractCtx);
  if (!ctx) throw new Error("useContracts must be inside ContractProvider");
  return ctx;
}
