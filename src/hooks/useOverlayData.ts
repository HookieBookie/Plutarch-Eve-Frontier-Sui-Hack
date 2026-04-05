import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

export interface OverlayMissionCard {
  goalId: number;
  goalDescription: string;
  goalStatus: string;
  missionIdx: number;
  phase: string;
  description: string;
  quantity: number;
  completedQty: number;
  progressPct: number;
  isPublished: boolean;
}

export interface OverlayAlert {
  type: string;
  message: string;
  severity: "info" | "success" | "warning" | "error";
}

export interface OverlaySettings {
  wallet: string;
  opacity: number;
  position: string;
  showAlerts: boolean;
  showMissions: boolean;
  showFuel: boolean;
}

export interface OverlayData {
  missions: OverlayMissionCard[];
  alerts: OverlayAlert[];
  settings: OverlaySettings;
  timestamp: number;
}

/** Fetch overlay data once via HTTP polling (React Query, 10s interval). */
export function useOverlayData(wallet: string, ssuId: string, tribeId: string) {
  return useQuery<OverlayData>({
    queryKey: ["overlay-data", wallet, ssuId, tribeId],
    queryFn: async () => {
      const res = await fetch(
        `/api/overlay-data?wallet=${encodeURIComponent(wallet)}&ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
      );
      if (!res.ok) throw new Error("Failed to fetch overlay data");
      return res.json();
    },
    enabled: !!wallet && !!ssuId && !!tribeId,
    refetchInterval: 10_000,
    staleTime: 8_000,
  });
}

/** Subscribe to real-time overlay updates via Server-Sent Events. */
export function useOverlayStream(wallet: string, ssuId: string, tribeId: string) {
  const [data, setData] = useState<OverlayData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!wallet || !ssuId || !tribeId) return;

    const url = `/api/overlay-stream?wallet=${encodeURIComponent(wallet)}&ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`;

    const es = new EventSource(url);
    esRef.current = es;

    es.onmessage = (event) => {
      try {
        setData(JSON.parse(event.data) as OverlayData);
        setError(null);
      } catch {
        // Malformed message — ignore
      }
    };

    es.onerror = () => {
      setError("Connection lost — retrying…");
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, [wallet, ssuId, tribeId]);

  return { data, error };
}
