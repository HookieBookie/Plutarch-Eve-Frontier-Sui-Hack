import { useState } from "react";
import type { OverlayAlert as AlertData } from "../../hooks/useOverlayData";

interface AlertBannerProps {
  alerts: AlertData[];
}

const SEVERITY_COLORS: Record<string, string> = {
  info: "#33AAFF",
  success: "#33CC66",
  warning: "#FF9900",
  error: "#FF4444",
};

const SEVERITY_ICONS: Record<string, string> = {
  info: "ℹ",
  success: "✓",
  warning: "⚠",
  error: "✕",
};

export function AlertBanner({ alerts }: AlertBannerProps) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const visible = alerts.filter((a) => !dismissed.has(`${a.type}:${a.message}`));
  if (visible.length === 0) return null;

  return (
    <div className="overlay-alerts">
      {visible.map((alert) => {
        const key = `${alert.type}:${alert.message}`;
        const color = SEVERITY_COLORS[alert.severity] ?? "#FF6600";
        const icon = SEVERITY_ICONS[alert.severity] ?? "•";
        return (
          <div key={key} className="overlay-alert" style={{ borderLeftColor: color }}>
            <span className="overlay-alert-icon" style={{ color }}>{icon}</span>
            <span className="overlay-alert-msg">{alert.message}</span>
            <button
              className="overlay-alert-dismiss"
              onClick={() => setDismissed((prev) => new Set([...prev, key]))}
              title="Dismiss"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
