import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";

/**
 * Per-tribe deployment config fetched dynamically from the backend.
 * Supports 100s of tribes — each with their own dynamically-published coin type.
 * TreasuryCap is stored inside the vault (no separate creditTreasuryId needed).
 */
export interface DeploymentConfig {
  packageId: string;
  registryId: string;
  creditCoinType: string;       // e.g. "0xabc::co86::CO86"
  creditMetadataId: string;     // CoinMetadata<C> shared object
  coinPackageId: string;        // Published coin module package ID
  systemManagerCapId: string;
}

interface DeploymentContextValue {
  config: DeploymentConfig | null;
  loading: boolean;
  error: string | null;
  /** Whether valid deployment config exists for the current tribe. */
  isConfigured: boolean;
  /** Save (or overwrite) deployment config for the current tribe. */
  saveConfig: (cfg: DeploymentConfig) => Promise<void>;
}

const DeploymentContext = createContext<DeploymentContextValue | null>(null);

function isValidConfig(c: unknown): c is DeploymentConfig {
  if (!c || typeof c !== "object") return false;
  const obj = c as Record<string, unknown>;
  // Only require packageId + registryId for validity.
  // creditCoinType is populated later during vault creation and may be empty initially.
  return (
    typeof obj.packageId === "string" && obj.packageId.length > 0 &&
    typeof obj.registryId === "string" && obj.registryId.length > 0
  );
}

export function DeploymentProvider({ tribeId, children }: { tribeId: string; children: ReactNode }) {
  const [config, setConfig] = useState<DeploymentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const tribeIdRef = useRef(tribeId);
  tribeIdRef.current = tribeId;

  useEffect(() => {
    if (!tribeId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetch(`/api/deployment?tribeId=${encodeURIComponent(tribeId)}`)
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (isValidConfig(data)) {
          setConfig(data);
        } else {
          setConfig(null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [tribeId]);

  const saveConfig = useCallback(async (cfg: DeploymentConfig) => {
    const tid = tribeIdRef.current;
    await fetch(`/api/deployment?tribeId=${encodeURIComponent(tid)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cfg),
    });
    setConfig(cfg);
  }, []);

  return (
    <DeploymentContext.Provider
      value={{
        config,
        loading,
        error,
        isConfigured: isValidConfig(config),
        saveConfig,
      }}
    >
      {children}
    </DeploymentContext.Provider>
  );
}

/** Access the per-tribe deployment config (packageId, treasuryId, etc.). */
export function useDeploymentConfig() {
  const ctx = useContext(DeploymentContext);
  if (!ctx) throw new Error("useDeploymentConfig must be used within DeploymentProvider");
  return ctx;
}

/** Extract the tribe currency ticker (e.g. "CO86") from the deployed coin type. */
export function useTicker(): string {
  const { config } = useDeploymentConfig();
  if (!config?.creditCoinType) return "Credits";
  const parts = config.creditCoinType.split("::");
  return parts.length >= 3 ? parts[2] : "Credits";
}
