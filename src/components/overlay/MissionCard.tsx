import type { OverlayMissionCard as MissionCardData } from "../../hooks/useOverlayData";

interface MissionCardProps {
  mission: MissionCardData;
}

const PHASE_COLORS: Record<string, string> = {
  GATHER: "#FF9900",
  REFINE: "#33AAFF",
  INDUSTRY: "#AA66FF",
  CONSTRUCT: "#33CC66",
};

export function MissionCard({ mission }: MissionCardProps) {
  const color = PHASE_COLORS[mission.phase] ?? "#FF6600";
  const isDone = mission.completedQty >= mission.quantity;

  return (
    <div className={`overlay-mission-card${isDone ? " overlay-mission-done" : ""}`}>
      <div className="overlay-mission-header">
        <span className="overlay-mission-phase" style={{ color }}>
          {mission.phase}
        </span>
        <span className="overlay-mission-goal muted">{mission.goalDescription}</span>
      </div>
      <div className="overlay-mission-desc">{mission.description}</div>
      <div className="overlay-mission-progress">
        <div
          className="overlay-mission-bar"
          style={{ width: `${mission.progressPct}%`, backgroundColor: isDone ? "var(--color-success)" : color }}
        />
      </div>
      <div className="overlay-mission-qty">
        {mission.completedQty} / {mission.quantity}
        {isDone && <span className="overlay-mission-complete-badge">✓</span>}
      </div>
    </div>
  );
}
