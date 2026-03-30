import { useState } from "react";
import type { MapNode, WaypointType, MapWaypoint } from "../hooks/useNetworkMap";
import { Select } from "./Select";
import { sanitiseLabel } from "../utils/ssuNames";

// ── Data categories available for data-link sharing ──
const DATA_CATEGORIES = ["goals", "market", "inventory"] as const;

// ── Waypoint types available for manual inter-system hops (no warp — warps are auto-added) ──
const ROUTE_WAYPOINT_OPTIONS: { value: string; label: string }[] = [
  { value: "smart_gate", label: "Smart Gate" },
  { value: "jump_gate", label: "Jump Gate" },
  { value: "ship_jump", label: "Ship Jump" },
];

/** Endpoint info returned alongside link creation for progressive naming. */
export interface EndpointInfo {
  system: string;
  systemId?: string;
  pNum: string;
  lNum: string;
}

interface LinkSetupProps {
  fromNode: MapNode;
  toNode: MapNode;
  existingLinkTypes?: Set<string>;
  onConfirm: (params: {
    linkType: "route" | "data";
    waypoints: MapWaypoint[];
    dataShares: string[];
    fromEndpoint?: EndpointInfo;
    toEndpoint?: EndpointInfo;
    rawRoute?: string;
  }) => void;
  onCancel: () => void;
}

type Step = "type" | "endpoints" | "route-steps" | "data-select";

interface WaypointDraft {
  waypointType: WaypointType;
  fromSystem: string;
  toSystem: string;
  fromSystemId?: string;
  toSystemId?: string;
  distance?: string;
}

function emptyHop(): WaypointDraft {
  return { waypointType: "smart_gate", fromSystem: "", toSystem: "" };
}

// ═══════════════════════════════════════════════════════════════════════════
// EF-Map Route Parser  (sanitised — never rendered as HTML)
// ═══════════════════════════════════════════════════════════════════════════
// Accepted format:
//   <a href="showinfo:5//30013445">ERR-HSD</a> 76.10→ <a href="showinfo:5//30022070">EFH-PDD</a> ...
// Legend:   Gate: (x)→   SmartGate: [SmartGate]→   Ship Jump: <distance>→   * = heat trap

const SYSTEM_NAME_RE = /^[A-Za-z0-9]{1,10}(-[A-Za-z0-9]{1,10}){0,4}$/;

interface ParsedHop {
  fromSystem: string;
  toSystem: string;
  fromSystemId?: string;
  toSystemId?: string;
  waypointType: WaypointType;
  distance?: string;
}

function detectHopType(gapText: string): { type: WaypointType; distance?: string } {
  const text = gapText.trim();
  if (/\([^)]*\)\s*→/.test(text)) return { type: "jump_gate" };
  if (/\[[^\]]*\]\s*→/.test(text)) return { type: "smart_gate" };
  const distMatch = text.match(/([\d]+\.?\d*)\s*→/);
  if (distMatch) return { type: "ship_jump", distance: distMatch[1] };
  return { type: "smart_gate" };
}

function parseEfMapRoute(raw: string): ParsedHop[] | null {
  const tagMatches = [...raw.matchAll(/<a[^>]*>([^<]+)<\/a>/gi)];
  let systems: string[];
  let systemIds: (string | undefined)[] = [];
  let gapTexts: string[] = [];

  if (tagMatches.length >= 2) {
    systems = tagMatches.map((m) => m[1].trim());
    // Extract system IDs from href="showinfo:5//NNNNNN"
    systemIds = tagMatches.map((m) => {
      const href = m[0].match(/href=["']showinfo:5\/\/(\d+)["']/i);
      return href ? href[1] : undefined;
    });
    if (!systems.every((n) => SYSTEM_NAME_RE.test(n))) return null;
    for (let i = 0; i < tagMatches.length - 1; i++) {
      const gapStart = tagMatches[i].index! + tagMatches[i][0].length;
      const gapEnd = tagMatches[i + 1].index!;
      gapTexts.push(raw.substring(gapStart, gapEnd));
    }
  } else {
    // Fallback: plain-text "SYS1 76.10→ SYS2" or "SYS1 → SYS2"
    const plain = raw.replace(/<[^>]*>/g, " ");
    const segments = plain.split(/→/);
    if (segments.length < 2) return null;
    const extracted: string[] = [];
    const gaps: string[] = [];
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i].trim();
      if (i === 0) {
        const m = seg.match(/([A-Za-z0-9]+-?[A-Za-z0-9]*)\s*$/);
        if (m) extracted.push(m[1]);
      } else {
        const m = seg.match(/^\s*(.*?)([A-Za-z0-9]+-?[A-Za-z0-9]*)\s*$/);
        if (m) { gaps.push(m[1] + "→"); extracted.push(m[2]); }
      }
    }
    if (!extracted.every((n) => SYSTEM_NAME_RE.test(n)) || extracted.length < 2) return null;
    systems = extracted;
    gapTexts = gaps;
  }

  const hops: ParsedHop[] = [];
  for (let i = 0; i < systems.length - 1; i++) {
    const gap = i < gapTexts.length ? gapTexts[i] : "";
    const { type, distance } = detectHopType(gap);
    hops.push({ fromSystem: systems[i], toSystem: systems[i + 1], fromSystemId: systemIds[i], toSystemId: systemIds[i + 1], waypointType: type, distance });
  }
  return hops;
}

// ═══════════════════════════════════════════════════════════════════════════

export function LinkSetupDialog({ fromNode, toNode, existingLinkTypes, onConfirm, onCancel }: LinkSetupProps) {
  const [step, setStep] = useState<Step>("type");
  const [linkType, setLinkType] = useState<"route" | "data">("route");

  // Endpoint L-Points (step 1 of route setup) — pre-fill from stored node data
  const [srcSystem, setSrcSystem] = useState(fromNode.solarSystemName ?? "");
  const [srcP, setSrcP] = useState(fromNode.pNum ?? "");
  const [srcL, setSrcL] = useState(fromNode.lNum ?? "");
  const [dstSystem, setDstSystem] = useState(toNode.solarSystemName ?? "");
  const [dstP, setDstP] = useState(toNode.pNum ?? "");
  const [dstL, setDstL] = useState(toNode.lNum ?? "");

  // Inter-system hops (step 2, only if cross-system)
  const [hops, setHops] = useState<WaypointDraft[]>([emptyHop()]);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  // Data link
  const [dataShares, setDataShares] = useState<Set<string>>(new Set());

  const fromLabel = sanitiseLabel(fromNode.label, fromNode.ssuId);
  const toLabel = sanitiseLabel(toNode.label, toNode.ssuId);

  // ── Type selection ──
  function handleTypeSelect(type: "route" | "data") {
    setLinkType(type);
    if (type === "route") setStep("endpoints");
    else setStep("data-select");
  }

  // ── Endpoint validation + same-system shortcut ──
  function handleEndpointsContinue() {
    const sameSystem = srcSystem.trim().toLowerCase() === dstSystem.trim().toLowerCase() && srcSystem.trim() !== "";
    if (sameSystem) {
      // Same system → auto-create a single warp and finish
      const wps: MapWaypoint[] = [{
        waypointType: "warp",
        fromSystem: srcSystem.trim(),
        toSystem: dstSystem.trim(),
        fromLpoint: `P${srcP}L${srcL}`,
        toLpoint: `P${dstP}L${dstL}`,
      }];
      const fromEp: EndpointInfo = { system: srcSystem.trim(), pNum: srcP.trim(), lNum: srcL.trim() };
      const toEp: EndpointInfo = { system: dstSystem.trim(), pNum: dstP.trim(), lNum: dstL.trim() };
      onConfirm({ linkType: "route", waypoints: wps, dataShares: [], fromEndpoint: fromEp, toEndpoint: toEp, rawRoute: pasteText.trim() || undefined });
      return;
    }
    setStep("route-steps");
  }

  // ── Hop management ──
  function addHop() { setHops((p) => [...p, emptyHop()]); }
  function removeHop(idx: number) { setHops((p) => p.filter((_, i) => i !== idx)); }
  function updateHop(idx: number, field: keyof WaypointDraft, value: string) {
    setHops((p) => p.map((h, i) => i === idx ? { ...h, [field]: value } : h));
  }

  // ── Paste route ──
  function handlePasteRoute() {
    const parsed = parseEfMapRoute(pasteText);
    if (!parsed || parsed.length < 1) {
      setPasteError("Could not parse route. Paste the EF-Map route text containing system names.");
      return;
    }
    setPasteError(null);
    const newHops: WaypointDraft[] = parsed.map((h) => ({
      waypointType: h.waypointType,
      fromSystem: h.fromSystem,
      toSystem: h.toSystem,
      fromSystemId: h.fromSystemId,
      toSystemId: h.toSystemId,
      distance: h.distance,
    }));
    setHops(newHops);
    // Also auto-fill source/dest system fields if empty
    if (!srcSystem.trim()) setSrcSystem(parsed[0].fromSystem);
    if (!dstSystem.trim()) setDstSystem(parsed[parsed.length - 1].toSystem);
  }

  // ── Data link toggle ──
  function toggleDataShare(cat: string) {
    setDataShares((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }

  // ── Final confirm ──
  function handleConfirm() {
    if (linkType === "data") {
      onConfirm({ linkType: "data", waypoints: [], dataShares: Array.from(dataShares) });
      return;
    }

    // Endpoint info for progressive naming
    const srcSysId = hops[0]?.fromSystemId || fromNode.solarSystemId || undefined;
    const dstSysId = hops[hops.length - 1]?.toSystemId || toNode.solarSystemId || undefined;
    const fromEndpoint: EndpointInfo = { system: srcSystem.trim(), systemId: srcSysId, pNum: srcP.trim(), lNum: srcL.trim() };
    const toEndpoint: EndpointInfo = { system: dstSystem.trim(), systemId: dstSysId, pNum: dstP.trim(), lNum: dstL.trim() };

    // Build full waypoint chain: warp (start) → hops → warp (end)
    const allWaypoints: MapWaypoint[] = [];

    // Start warp: from source SSU L-Point in the source system
    allWaypoints.push({
      waypointType: "warp",
      fromSystem: srcSystem.trim(),
      toSystem: srcSystem.trim(),
      fromSystemId: srcSysId,
      toSystemId: srcSysId,
      fromLpoint: srcP && srcL ? `P${srcP}L${srcL}` : "",
      toLpoint: "",
    });

    // Intermediate hops
    for (const hop of hops) {
      if (hop.fromSystem.trim() && hop.toSystem.trim()) {
        allWaypoints.push({
          waypointType: hop.waypointType,
          fromSystem: hop.fromSystem.trim(),
          toSystem: hop.toSystem.trim(),
          fromSystemId: hop.fromSystemId,
          toSystemId: hop.toSystemId,
          fromLpoint: "",
          toLpoint: "",
          distance: hop.distance,
        });
      }
    }

    // End warp: to destination SSU L-Point in the destination system
    allWaypoints.push({
      waypointType: "warp",
      fromSystem: dstSystem.trim(),
      toSystem: dstSystem.trim(),
      fromSystemId: dstSysId,
      toSystemId: dstSysId,
      fromLpoint: "",
      toLpoint: dstP && dstL ? `P${dstP}L${dstL}` : "",
    });

    onConfirm({ linkType: "route", waypoints: allWaypoints, dataShares: [], fromEndpoint, toEndpoint, rawRoute: pasteText.trim() || undefined });
  }

  // ── Validation ──
  const endpointsValid = srcSystem.trim() !== "" && dstSystem.trim() !== "" && srcP !== "" && srcL !== "" && dstP !== "" && dstL !== "";
  const routeValid = hops.some((h) => h.fromSystem.trim() && h.toSystem.trim());
  const dataValid = dataShares.size > 0;

  return (
    <div className="market-browser-backdrop" onClick={onCancel}>
      <div className="panel link-setup-dialog" onClick={(e) => e.stopPropagation()}>
        <h3 style={{ marginBottom: "0.5rem" }}>
          Link: {fromLabel} → {toLabel}
        </h3>

        {/* ═══ Step: Type Selection ═══ */}
        {step === "type" && (
          <div className="link-type-selector">
            <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.75rem" }}>
              Choose a link type:
            </p>
            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button className="btn-primary" onClick={() => handleTypeSelect("route")} disabled={existingLinkTypes?.has("route")} style={{ flex: 1 }}>
                Route
                <span className="btn-hint">{existingLinkTypes?.has("route") ? "Already exists" : "Navigation path between SSUs"}</span>
              </button>
              <button className="btn-primary" onClick={() => handleTypeSelect("data")} disabled={existingLinkTypes?.has("data")} style={{ flex: 1 }}>
                Data Link
                <span className="btn-hint">{existingLinkTypes?.has("data") ? "Already exists" : "Share information only"}</span>
              </button>
            </div>
          </div>
        )}

        {/* ═══ Step: Endpoint L-Points ═══ */}
        {step === "endpoints" && (
          <div className="link-endpoints-setup">
            <p className="muted" style={{ fontSize: "0.72rem", marginBottom: "0.6rem" }}>
              Enter the L-Point locations for each SSU. If both are in the same system, the route will be created automatically.
            </p>

            {/* Source SSU */}
            <div className="endpoint-block">
              <span className="endpoint-label">Source: {fromLabel}</span>
              <div className="endpoint-row">
                <label className="waypoint-label">System</label>
                <input
                  type="text" className="waypoint-system-input"
                  placeholder="e.g. ERR-HSD"
                  value={srcSystem}
                  onChange={(e) => setSrcSystem(e.target.value)}
                  readOnly={!!fromNode.solarSystemName}
                  style={fromNode.solarSystemName ? { opacity: 0.7 } : undefined}
                />
              </div>
              <div className="endpoint-row">
                <label className="waypoint-label">L-Point</label>
                <span className="lpoint-prefix">P</span>
                <input type="number" min="1" className="lpoint-input" placeholder="#" value={srcP} onChange={(e) => setSrcP(e.target.value)} />
                <span className="lpoint-sep">L</span>
                <input type="number" min="1" className="lpoint-input" placeholder="#" value={srcL} onChange={(e) => setSrcL(e.target.value)} />
              </div>
            </div>

            {/* Destination SSU */}
            <div className="endpoint-block">
              <span className="endpoint-label">Destination: {toLabel}</span>
              <div className="endpoint-row">
                <label className="waypoint-label">System</label>
                <input
                  type="text" className="waypoint-system-input"
                  placeholder="e.g. UVT-1BC"
                  value={dstSystem}
                  onChange={(e) => setDstSystem(e.target.value)}
                  readOnly={!!toNode.solarSystemName}
                  style={toNode.solarSystemName ? { opacity: 0.7 } : undefined}
                />
              </div>
              <div className="endpoint-row">
                <label className="waypoint-label">L-Point</label>
                <span className="lpoint-prefix">P</span>
                <input type="number" min="1" className="lpoint-input" placeholder="#" value={dstP} onChange={(e) => setDstP(e.target.value)} />
                <span className="lpoint-sep">L</span>
                <input type="number" min="1" className="lpoint-input" placeholder="#" value={dstL} onChange={(e) => setDstL(e.target.value)} />
              </div>
            </div>
          </div>
        )}

        {/* ═══ Step: Inter-System Route ═══ */}
        {step === "route-steps" && (
          <div className="link-route-setup">
            <p className="muted" style={{ fontSize: "0.72rem", marginBottom: "0.5rem" }}>
              Add the gate / jump chain between systems, or paste an EF-Map route.
            </p>

            {/* Paste section */}
            <div className="ef-map-paste">
              <textarea
                className="ef-map-textarea"
                rows={3}
                placeholder="Paste EF-Map route here…"
                value={pasteText}
                onChange={(e) => setPasteText(e.target.value)}
              />
              <button className="btn-subtle" onClick={handlePasteRoute} disabled={!pasteText.trim()}>
                Parse Route
              </button>
              {pasteError && <span className="paste-error">{pasteError}</span>}
            </div>

            <div className="route-divider">
              <span className="route-divider-text">or enter manually</span>
            </div>

            {/* Manual hops */}
            {hops.map((hop, idx) => (
              <div key={idx} className="waypoint-row">
                <div className="waypoint-header">
                  <span className="waypoint-step">Hop {idx + 1}</span>
                  <Select
                    value={hop.waypointType}
                    onChange={(v) => updateHop(idx, "waypointType", v)}
                    options={ROUTE_WAYPOINT_OPTIONS}
                    className="waypoint-type-select"
                  />
                  {hops.length > 1 && (
                    <button className="btn-subtle btn-sm-network" onClick={() => removeHop(idx)}>✕</button>
                  )}
                </div>
                <div className="waypoint-fields">
                  <div className="waypoint-system-group">
                    <label className="waypoint-label">From System</label>
                    <input
                      type="text" className="waypoint-system-input"
                      placeholder="e.g. ERR-HSD"
                      value={hop.fromSystem}
                      onChange={(e) => updateHop(idx, "fromSystem", e.target.value)}
                    />
                  </div>
                  <div className="waypoint-system-group">
                    <label className="waypoint-label">To System</label>
                    <input
                      type="text" className="waypoint-system-input"
                      placeholder="e.g. EFH-PDD"
                      value={hop.toSystem}
                      onChange={(e) => updateHop(idx, "toSystem", e.target.value)}
                    />
                  </div>
                </div>
              </div>
            ))}

            <button className="btn-subtle" onClick={addHop} style={{ marginTop: "0.5rem", fontSize: "0.72rem" }}>
              + Add Hop
            </button>
          </div>
        )}

        {/* ═══ Step: Data Select ═══ */}
        {step === "data-select" && (
          <div className="link-data-setup">
            <p className="muted" style={{ fontSize: "0.72rem", marginBottom: "0.5rem" }}>
              Select which data categories to share via this link:
            </p>
            <div className="data-share-warning">
              ⚠ Data links are bidirectional — both SSUs will share <strong>and</strong> receive
              the selected categories. Your SSU will expose the same data you request.
            </div>
            <div className="data-share-grid">
              {DATA_CATEGORIES.map((cat) => (
                <label key={cat} className="data-share-item">
                  <input
                    type="checkbox"
                    checked={dataShares.has(cat)}
                    onChange={() => toggleDataShare(cat)}
                  />
                  <span style={{ textTransform: "capitalize" }}>{cat}</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* ═══ Footer buttons ═══ */}
        {step !== "type" && (
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "flex-end", marginTop: "1rem" }}>
            <button
              className="btn-cancel"
              onClick={
                step === "route-steps" ? () => setStep("endpoints")
                  : step === "endpoints" || step === "data-select" ? () => setStep("type")
                    : onCancel
              }
            >
              Back
            </button>
            {step === "endpoints" && (
              <button className="btn-primary" onClick={handleEndpointsContinue} disabled={!endpointsValid}>
                Continue
              </button>
            )}
            {step === "route-steps" && (
              <button className="btn-primary" onClick={handleConfirm} disabled={!routeValid}>
                Create Route
              </button>
            )}
            {step === "data-select" && (
              <button className="btn-primary" onClick={handleConfirm} disabled={!dataValid}>
                Create Link
              </button>
            )}
          </div>
        )}

        {step === "type" && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1rem" }}>
            <button className="btn-cancel" onClick={onCancel}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
