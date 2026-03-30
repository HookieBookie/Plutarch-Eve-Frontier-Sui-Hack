import { useAllTribes } from "../hooks/useAllTribes";
import { CREDIT_MULTIPLIER } from "../config";

/** Scrolling bottom ticker showing all tribes' credit value & backing ratio. */
export function PriceTicker() {
  const { data: tribes } = useAllTribes();

  if (!tribes || tribes.length === 0) return null;

  const items = tribes.map((t) => {
    const name = t.tribeName ?? `Tribe ${t.tribeId}`;
    const supply = ((t.vault?.creditSupply ?? 0) / 1e9).toLocaleString();
    const backing = ((t.vault?.eveBacking ?? 0) / 1e9).toLocaleString();
    return (
      <span key={t.tribeId}>
        <span className="ticker-item ticker-tribe">{name}</span>
        <span className="ticker-separator">|</span>
        <span className="ticker-item">1 EVE = {CREDIT_MULTIPLIER} {t.ticker}</span>
        <span className="ticker-separator">|</span>
        <span className="ticker-item">Supply: {supply} {t.ticker}</span>
        <span className="ticker-separator">|</span>
        <span className="ticker-item">Backing: {backing} EVE</span>
        <span className="ticker-separator">|</span>
      </span>
    );
  });

  return (
    <div className="ticker-bar">
      <div className="ticker-track">
        <span className="ticker-content">{items}{items}{items}{items}</span>
        <span className="ticker-content">{items}{items}{items}{items}</span>
      </div>
    </div>
  );
}
