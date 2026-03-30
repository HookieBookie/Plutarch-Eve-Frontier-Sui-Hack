import { useState, useMemo, useRef, useEffect } from "react";
import { useAllTribes, type TribeInfo } from "../hooks/useAllTribes";
import { usePriceHistory, recordPriceSnapshot } from "../hooks/usePriceHistory";
import { CREDIT_MULTIPLIER, FEE_BPS } from "../config";

/** Floor a number to 6 decimal places for display. */
function floor6(n: number): string {
  return (Math.floor(n * 1e6) / 1e6).toFixed(6);
}

/** Sparkline mini-chart drawn on a canvas element. */
function Sparkline({ data, width = 120, height = 28, color = "#4fc3f7" }: {
  data: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || data.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pad = 2;

    ctx.clearRect(0, 0, width, height);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    data.forEach((v, i) => {
      const x = (i / (data.length - 1)) * (width - pad * 2) + pad;
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // Fill area below
    const lastX = width - pad;
    ctx.lineTo(lastX, height);
    ctx.lineTo(pad, height);
    ctx.closePath();
    ctx.fillStyle = color.replace(")", ", 0.08)").replace("rgb", "rgba");
    ctx.fill();
  }, [data, width, height, color]);

  if (data.length < 2) return <span className="muted" style={{ fontSize: "0.7rem" }}>No data</span>;
  return <canvas ref={canvasRef} style={{ width, height }} />;
}

/** Row in the tribe market board. */
function TribeRow({ tribe, selected, onSelect }: {
  tribe: TribeInfo;
  selected: boolean;
  onSelect: () => void;
}) {
  const vault = tribe.vault;
  if (!vault) return null;

  const ratio = vault.backingRatio;
  const pricePerCredit = vault.creditSupply > 0
    ? (vault.eveBacking / vault.creditSupply)
    : 0;
  const eveLocked = vault.eveBacking / 1e9;
  const supply = vault.creditSupply / 1e9;

  // Determine health color
  const health =
    ratio >= 0.009 ? "healthy" :
    ratio >= 0.005 ? "warning" :
    "critical";

  return (
    <tr
      className={`tribe-market-row ${selected ? "selected" : ""} ${health}`}
      onClick={onSelect}
      style={{ cursor: "pointer" }}
    >
      <td className="tribe-ticker-cell">
        <strong>{tribe.ticker}</strong>
        <span className="tribe-name-sub">{tribe.tribeName ?? `Tribe ${tribe.tribeId}`}</span>
      </td>
      <td className="tribe-price-cell">{floor6(pricePerCredit)} EVE</td>
      <td className="tribe-ratio-cell">
        <span className={`health-dot health-${health}`} />
        {(ratio * CREDIT_MULTIPLIER * 100).toFixed(1)}%
      </td>
      <td className="tribe-supply-cell">{supply.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
      <td className="tribe-locked-cell">{eveLocked.toLocaleString(undefined, { maximumFractionDigits: 2 })} EVE</td>
    </tr>
  );
}

/** Detail panel for selected tribe — shows price chart. */
function TribeDetail({ tribe }: { tribe: TribeInfo }) {
  const { data: history } = usePriceHistory(tribe.tribeId);

  // Record current snapshot if vault data exists (periodic)
  const lastRecordRef = useRef(0);
  useEffect(() => {
    if (!tribe.vault) return;
    const now = Date.now();
    // Only record once per 5 minutes
    if (now - lastRecordRef.current < 300_000) return;
    lastRecordRef.current = now;
    recordPriceSnapshot({
      tribeId: tribe.tribeId,
      eveBacking: tribe.vault.eveBacking,
      creditSupply: tribe.vault.creditSupply,
      backingRatio: tribe.vault.backingRatio,
    });
  }, [tribe.tribeId, tribe.vault]);

  const chartData = useMemo(() => {
    if (!history?.length) return [];
    return [...history].reverse().map((s) => s.backingRatio);
  }, [history]);

  const vault = tribe.vault;
  if (!vault) return null;

  const ratio = vault.backingRatio;
  const pricePerCredit = vault.creditSupply > 0 ? vault.eveBacking / vault.creditSupply : 0;
  const feePct = FEE_BPS / 100;

  return (
    <div className="tribe-detail-panel">
      <div className="tribe-detail-header">
        <h4>{tribe.ticker} — {tribe.tribeName ?? `Tribe ${tribe.tribeId}`}</h4>
        {vault.creditBudget > 0 && (
          <span className="tribe-budget-badge">Budget: {(vault.creditBudget / 1e9).toLocaleString()} {tribe.ticker}</span>
        )}
      </div>

      <div className="tribe-detail-stats">
        <div className="stat">
          <span className="stat-label">Price / credit</span>
          <span className="stat-value">{floor6(pricePerCredit)} EVE</span>
        </div>
        <div className="stat">
          <span className="stat-label">Backing ratio</span>
          <span className="stat-value">{(ratio * CREDIT_MULTIPLIER * 100).toFixed(2)}%</span>
        </div>
        <div className="stat">
          <span className="stat-label">Mint rate</span>
          <span className="stat-value">1 EVE → {CREDIT_MULTIPLIER} {tribe.ticker} (−{feePct}%)</span>
        </div>
        <div className="stat">
          <span className="stat-label">Redeem rate</span>
          <span className="stat-value">{CREDIT_MULTIPLIER} {tribe.ticker} → {(ratio * CREDIT_MULTIPLIER * (1 - feePct / 100)).toFixed(4)} EVE</span>
        </div>
      </div>

      <div className="tribe-chart-container">
        <span className="chart-label">Backing Ratio History</span>
        <Sparkline data={chartData} width={280} height={60} color={ratio >= 0.009 ? "#4fc3f7" : ratio >= 0.005 ? "#ffb74d" : "#ef5350"} />
      </div>

      {/* Dilution warning */}
      {ratio < 0.008 && (
        <p className="tribe-dilution-warning">
          ⚠ Backing ratio below par — this tribe may have diluted supply or experienced large sell-offs.
        </p>
      )}
    </div>
  );
}

/** Multi-tribe market board / ticker display. */
export function TribeMarketBoard({ onSelect }: { onSelect?: (tribe: TribeInfo) => void }) {
  const { data: tribes, isLoading } = useAllTribes();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selected = useMemo(() => {
    if (!selectedId || !tribes) return null;
    return tribes.find((t) => t.tribeId === selectedId) ?? null;
  }, [selectedId, tribes]);

  if (isLoading) return <p className="muted">Loading tribe market data…</p>;
  if (!tribes?.length) return <p className="muted">No tribes registered yet</p>;

  return (
    <div className="tribe-market-board">
      <table className="tribe-market-table">
        <thead>
          <tr>
            <th>Tribe</th>
            <th>Price</th>
            <th>Health</th>
            <th>Supply</th>
            <th>EVE Locked</th>
          </tr>
        </thead>
        <tbody>
          {tribes.map((t) => (
            <TribeRow
              key={t.tribeId}
              tribe={t}
              selected={selectedId === t.tribeId}
              onSelect={() => {
                setSelectedId(t.tribeId === selectedId ? null : t.tribeId);
                onSelect?.(t);
              }}
            />
          ))}
        </tbody>
      </table>

      {selected && <TribeDetail tribe={selected} />}
    </div>
  );
}
