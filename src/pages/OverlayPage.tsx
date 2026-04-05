import { useState } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useOverlayStream } from "../hooks/useOverlayData";
import { MissionCard } from "../components/overlay/MissionCard";
import { AlertBanner } from "../components/overlay/AlertBanner";

interface OverlayPageProps {
  ssuId: string;
  tribeId: string;
}

/**
 * Lightweight overlay page designed to be popped out into a small browser
 * window (or loaded in the Electron companion app) while playing Eve Frontier.
 *
 * URL: /overlay or opened via the pop-out button in the Toolbar.
 */
export function OverlayPage({ ssuId, tribeId }: OverlayPageProps) {
  const account = useCurrentAccount();
  const wallet = account?.address ?? "";
  const { data, error } = useOverlayStream(wallet, ssuId, tribeId);
  const [minimised, setMinimised] = useState(false);

  if (!wallet) {
    return (
      <div className="overlay-page overlay-page-disconnected">
        <div className="overlay-logo">PLUTARCH</div>
        <p className="muted">Connect your wallet to see your missions.</p>
      </div>
    );
  }

  if (!ssuId) {
    return (
      <div className="overlay-page overlay-page-disconnected">
        <div className="overlay-logo">PLUTARCH</div>
        <p className="muted">No SSU selected. Open the main dApp first.</p>
      </div>
    );
  }

  return (
    <div className="overlay-page" style={{ opacity: data?.settings.opacity ?? 0.9 }}>
      <div className="overlay-titlebar">
        <span className="overlay-logo">PLUTARCH</span>
        {error && <span className="overlay-status-dot overlay-status-error" title={error} />}
        {!error && data && <span className="overlay-status-dot overlay-status-ok" title="Live" />}
        <button
          className="overlay-minimise"
          onClick={() => setMinimised((v) => !v)}
          title={minimised ? "Expand" : "Minimise"}
        >
          {minimised ? "▲" : "▼"}
        </button>
      </div>

      {!minimised && (
        <div className="overlay-body">
          {data?.settings.showAlerts && data.alerts.length > 0 && (
            <AlertBanner alerts={data.alerts} />
          )}

          {data?.settings.showMissions && (
            <div className="overlay-missions">
              {!data || data.missions.length === 0 ? (
                <p className="muted overlay-empty">
                  No missions subscribed yet.
                  <br />
                  Use <strong>Home → Overlay</strong> to subscribe.
                </p>
              ) : (
                data.missions.map((m) => (
                  <MissionCard key={`${m.goalId}-${m.missionIdx}`} mission={m} />
                ))
              )}
            </div>
          )}

          {!data && !error && (
            <p className="muted overlay-empty">Connecting…</p>
          )}
        </div>
      )}
    </div>
  );
}
