import { useState } from "react";

/** Resolve a typeId to its static icon path (served by Vite from public/icons/). */
export function itemIconUrl(typeId: number | undefined): string | undefined {
  if (!typeId || typeId <= 0) return undefined;
  return `/icons/${typeId}.png`;
}

interface ItemIconProps {
  typeId: number | undefined;
  size?: number;
  className?: string;
}

/** Renders an item icon for the given EVE Frontier typeId. Gracefully hides if the icon is missing. */
export function ItemIcon({ typeId, size = 24, className }: ItemIconProps) {
  const [hidden, setHidden] = useState(false);
  const url = itemIconUrl(typeId);
  if (!url || hidden) return null;
  return (
    <img
      src={url}
      alt=""
      className={className ?? "item-icon"}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setHidden(true)}
    />
  );
}

const PHASE_ICONS: Record<string, string> = {
  GATHER: "⛏",
  REFINE: "🔥",
  PRINT: "🖨",
  ACQUIRE: "🎯",
  DELIVER: "📦",
};

interface MissionIconProps {
  typeId: number | undefined;
  phase: string;
  size?: number;
}

/** Item icon with a phase-specific emoji fallback when no item icon is available. */
export function MissionIcon({ typeId, phase, size = 18 }: MissionIconProps) {
  const [hidden, setHidden] = useState(false);
  const url = itemIconUrl(typeId);
  if (!url || hidden) {
    const emoji = PHASE_ICONS[phase] ?? "📋";
    return <span className="item-icon-fallback" style={{ fontSize: size * 0.8, lineHeight: `${size}px`, width: size, height: size, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{emoji}</span>;
  }
  return (
    <img
      src={url}
      alt=""
      className="item-icon"
      width={size}
      height={size}
      loading="lazy"
      onError={() => setHidden(true)}
    />
  );
}
