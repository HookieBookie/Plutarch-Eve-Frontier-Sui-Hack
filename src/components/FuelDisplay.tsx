import { formatTimeRemaining } from "../hooks/useNetworkNodeFuel";

const MS_24H = 24 * 60 * 60 * 1000;

interface FuelProgressBarProps {
  percent: number;
  msRemaining: number;
  compact?: boolean;
}

export function FuelProgressBar({ percent, msRemaining, compact }: FuelProgressBarProps) {
  const isLow = isFinite(msRemaining) && msRemaining > 0 && msRemaining < MS_24H;
  const isEmpty = !isFinite(msRemaining) || msRemaining <= 0;
  const barColor = isEmpty
    ? "#555"
    : isLow
      ? "#e53e3e"
      : percent < 40
        ? "#FF6600"
        : "#38a169";

  const height = compact ? 6 : 8;

  return (
    <div
      style={{
        background: "rgba(255,255,255,0.08)",
        borderRadius: height / 2,
        overflow: "hidden",
        height,
        width: "100%",
      }}
      title={`${(percent ?? 0).toFixed(1)}% — ${formatTimeRemaining(msRemaining)} remaining`}
    >
      <div
        style={{
          height: "100%",
          width: `${Math.min(100, Math.max(0, percent))}%`,
          background: barColor,
          borderRadius: height / 2,
          transition: "width 0.5s ease, background 0.3s ease",
        }}
      />
    </div>
  );
}

interface FuelDisplayProps {
  percent: number;
  msRemaining: number;
  isBurning: boolean;
  quantity: number;
  timeRemainingLabel: string;
  compact?: boolean;
}

export function FuelDisplay({
  percent, msRemaining, isBurning, quantity, timeRemainingLabel, compact,
}: FuelDisplayProps) {
  const isLow = isFinite(msRemaining) && msRemaining > 0 && msRemaining < MS_24H;
  const isEmpty = !isFinite(msRemaining) || msRemaining <= 0;
  const textColor = isEmpty ? "#888" : isLow ? "#e53e3e" : undefined;

  return (
    <div>
      <FuelProgressBar percent={percent} msRemaining={msRemaining} compact={compact} />
      <div style={{
        fontSize: compact ? "0.62rem" : "0.7rem",
        marginTop: "0.2rem",
        opacity: 0.85,
        color: textColor,
      }}>
        {isBurning
          ? `${(percent ?? 0).toFixed(1)}% — ${timeRemainingLabel} remaining`
          : quantity > 0
            ? "Offline (not burning)"
            : "Empty"}
        {isLow && isBurning && " ⚠"}
      </div>
    </div>
  );
}
