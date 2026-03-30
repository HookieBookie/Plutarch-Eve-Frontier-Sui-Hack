import { useState, useRef, useCallback, useMemo, useEffect, type MouseEvent, type WheelEvent } from "react";
import type { MapNode, MapLink, WaypointType } from "../hooks/useNetworkMap";
import { waypointLabel } from "../hooks/useNetworkMap";
import { sanitiseLabel } from "../utils/ssuNames";

// ── Constants ──

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.15;
const NODE_SIZE = 36; // side length of square node

// ── Color palette (clearer ownership distinction) ──

const COLORS = {
  currentSsu: "#00CCFF",    // bright cyan — YOUR current SSU (unmistakable)
  owned: "#FF6600",         // accent orange — SSUs you operate
  tribe: "#7B68EE",         // medium slate blue — tribe members' SSUs
  universal: "#33CC66",     // green — public/universal SSUs
  other: "rgba(250,250,229,0.5)",  // muted — everything else
  dataLink: "rgba(51,204,102,0.2)",       // faint green
  dataLinkHover: "rgba(51,204,102,0.65)", // brighter green on hover
  routeChain: "#FAFAE5",
  routeChainDim: "rgba(250,250,229,0.4)",
  gridLine: "rgba(250,250,229,0.04)",
  dataMidpoint: "#33CC66",
};

// ── Icon paths (inline SVG) ──

const ICON_PATHS: Record<string, string> = {
  ssu: "M12 2L2 7v10l10 5 10-5V7L12 2zm0 2.3L20 8v8l-8 4-8-4V8l8-3.7z",
  smart_gate: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z",
  jump_gate: "M12 2L4 5v6.09c0 5.05 3.41 9.76 8 10.91 4.59-1.15 8-5.86 8-10.91V5l-8-3zm6 9.09c0 4-2.55 7.7-6 8.83-3.45-1.13-6-4.82-6-8.83V6.31l6-2.25 6 2.25v4.78z",
  ship_jump: "M20.5 3l-.16.03L15 5.1 9 3 3.36 4.9c-.21.07-.36.25-.36.48V20.5c0 .28.22.5.5.5l.16-.03L9 18.9l6 2.1 5.64-1.9c.21-.07.36-.25.36-.48V3.5c0-.28-.22-.5-.5-.5zM15 19l-6-2.11V5l6 2.11V19z",
  warp: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L10 14v1c0 1.1.9 2 2 2v1.93zM17.9 17.39c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z",
};

// ── Waypoint icon (small, for midpoints on route links) ──

function WaypointIcon({ type, x, y, size = 10 }: { type: WaypointType; x: number; y: number; size?: number }) {
  const half = size / 2;
  const iconPath = ICON_PATHS[type] ?? ICON_PATHS.warp;
  return (
    <g transform={`translate(${x - half}, ${y - half})`}>
      <svg width={size} height={size} viewBox="0 0 24 24">
        <path d={iconPath} fill={COLORS.routeChain} fillOpacity={0.7} />
      </svg>
    </g>
  );
}

// ── Data share midpoint icon ──

const DATA_ICON_MAP: Record<string, string> = {
  goals: "⚑",
  market: "◈",
  inventory: "▤",
};

function DataMidpointIcon({ x, y, shares }: { x: number; y: number; shares: string[] }) {
  const label = shares.map((s) => DATA_ICON_MAP[s] ?? "·").join("");
  return (
    <g>
      <rect x={x - 14} y={y - 8} width={28} height={16} rx={3}
        fill="var(--color-surface, #141414)" stroke={COLORS.dataMidpoint} strokeWidth={1} opacity={0.9} />
      <text x={x} y={y + 4} textAnchor="middle" fontSize={9} fill={COLORS.dataMidpoint}
        style={{ pointerEvents: "none", userSelect: "none" }}>
        {label}
      </text>
    </g>
  );
}

// ── Exported types ──

export type MapFilter = "all" | "tribe" | "owned" | "universal";

interface Props {
  nodes: MapNode[];
  links: MapLink[];
  currentSsuId: string;
  currentSolarSystem: string | null;
  walletAddress: string;
  ownedSsuIds?: Set<string>;
  filter: MapFilter;
  highlightNodeId: string | null;
  linkableNodeIds?: Set<string>;
  dataReachableNodeIds?: Set<string>;
  onSelectNode: (nodeId: string | null) => void;
  onMoveNode: (nodeId: string, x: number, y: number) => void;
  onStartLink: (nodeId: string) => void;
  onRemoveNode?: (nodeId: string) => void;
  onDeleteLink?: (linkId: string) => void;
  onBrowseRemote?: (nodeId: string) => void;
  isOwner?: boolean;
  /** Fuel info keyed by ssuId, for node tooltip display. */
  fuelBySsuId?: Map<string, { percent: number; msRemaining: number; isBurning: boolean; timeRemainingLabel: string }>;
}

export function NetworkMapCanvas({
  nodes,
  links,
  currentSsuId,
  currentSolarSystem: _currentSolarSystem,
  walletAddress: _walletAddress,
  ownedSsuIds,
  filter,
  highlightNodeId,
  linkableNodeIds,
  dataReachableNodeIds,
  onSelectNode,
  onMoveNode,
  onStartLink,
  onRemoveNode,
  onDeleteLink,
  onBrowseRemote,
  isOwner = true,
  fuelBySsuId,
}: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Pan / Zoom state ──
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const panStart = useRef({ x: 0, y: 0 });
  const panOrigin = useRef({ x: 0, y: 0 });

  // ── Drag node state ──
  const [dragging, setDragging] = useState<string | null>(null);
  const dragOffset = useRef({ x: 0, y: 0 });

  // ── Hover state ──
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [hoveredLink, setHoveredLink] = useState<string | null>(null);

  // ── Tooltip state ──
  const [tooltip, setTooltip] = useState<{ x: number; y: number; content: string[] } | null>(null);

  // ── Copy notification state ──
  const [copyNotification, setCopyNotification] = useState<{ x: number; y: number } | null>(null);

  // ── Context menu state ──
  const [ctxMenu, setCtxMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [linkCtxMenu, setLinkCtxMenu] = useState<{ linkId: string; x: number; y: number } | null>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu && !linkCtxMenu) return;
    function onDown(e: globalThis.MouseEvent) {
      if (containerRef.current && !containerRef.current.querySelector(".map-ctx-menu")?.contains(e.target as Node)) {
        setCtxMenu(null);
        setLinkCtxMenu(null);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [ctxMenu, linkCtxMenu]);

  // ── Filter nodes — map always shows all, filter only dims non-matching ──
  const filteredNodes = useMemo(() => nodes, [nodes]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  // Set of nodes matching the active filter (used for dimming)
  const filterMatchIds = useMemo(() => {
    return new Set(nodes.filter((n) => {
      if (filter === "owned") return ownedSsuIds?.has(n.ssuId) ?? false;
      if (filter === "universal") return n.visibility === "public" || n.visibility === "external";
      // "all" and "tribe" match everything
      return true;
    }).map((n) => n.id));
  }, [nodes, filter, ownedSsuIds]);

  const filteredLinks = useMemo(() => {
    return links.filter((l) => filteredNodeIds.has(l.fromNodeId) && filteredNodeIds.has(l.toNodeId));
  }, [links, filteredNodeIds]);

  // Set of node pairs that have BOTH route and data links (need parallel offset)
  const dualLinkPairs = useMemo(() => {
    const pairKey = (a: string, b: string) => a < b ? `${a}|${b}` : `${b}|${a}`;
    const byType = new Map<string, Set<string>>();
    for (const l of filteredLinks) {
      const k = pairKey(l.fromNodeId, l.toNodeId);
      if (!byType.has(k)) byType.set(k, new Set());
      byType.get(k)!.add(l.linkType);
    }
    const dual = new Set<string>();
    for (const [k, types] of byType) {
      if (types.has("route") && types.has("data")) dual.add(k);
    }
    return dual;
  }, [filteredLinks]);

  const nodeMap = useMemo(() => {
    const m = new Map<string, MapNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // ── Color for a node (clear ownership distinction) ──
  function nodeColor(n: MapNode): string {
    if (n.ssuId === currentSsuId) return COLORS.currentSsu;
    if (ownedSsuIds?.has(n.ssuId)) return COLORS.owned;
    if (n.visibility === "public" || n.visibility === "external") return COLORS.universal;
    return COLORS.tribe;
  }

  // ── Is node dimmed by the current filter? ──
  function isNodeDimmed(n: MapNode): boolean {
    return filter !== "all" && !filterMatchIds.has(n.id);
  }

  // ── Coordinate conversion ──
  function screenToWorld(sx: number, sy: number) {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return {
      x: (sx - rect.left - pan.x) / zoom,
      y: (sy - rect.top - pan.y) / zoom,
    };
  }

  // ── Handlers ──

  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const direction = e.deltaY < 0 ? 1 : -1;
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + direction * ZOOM_STEP));
    const scale = newZoom / zoom;
    setPan({ x: mx - (mx - pan.x) * scale, y: my - (my - pan.y) * scale });
    setZoom(newZoom);
  }, [zoom, pan]);

  function handleMouseDown(e: MouseEvent) {
    if (e.button !== 0) return;
    // Not on a node — start panning
    setIsPanning(true);
    panStart.current = { x: e.clientX, y: e.clientY };
    panOrigin.current = { ...pan };
  }

  function handleMouseMove(e: MouseEvent) {
    if (dragging) {
      const world = screenToWorld(e.clientX, e.clientY);
      // Use a direct DOM update for performance, commit on mouseup
      const el = svgRef.current?.querySelector(`[data-node-id="${dragging}"]`) as SVGGElement | null;
      if (el) el.setAttribute("transform", `translate(${world.x}, ${world.y})`);
      dragOffset.current = { x: world.x, y: world.y };
      return;
    }
    if (isPanning) {
      const dx = e.clientX - panStart.current.x;
      const dy = e.clientY - panStart.current.y;
      setPan({ x: panOrigin.current.x + dx, y: panOrigin.current.y + dy });
    }
  }

  function handleMouseUp() {
    if (dragging) {
      onMoveNode(dragging, dragOffset.current.x, dragOffset.current.y);
      setDragging(null);
    }
    setIsPanning(false);
  }

  function handleNodeMouseDown(e: MouseEvent, nodeId: string) {
    if (e.button !== 0) return; // only left-click starts drag
    if (!isOwner) return; // non-owners cannot drag/reposition nodes
    e.stopPropagation();
    const world = screenToWorld(e.clientX, e.clientY);
    dragOffset.current = world;
    setDragging(nodeId);
  }

  function handleNodeClick(e: MouseEvent, nodeId: string) {
    if (dragging) return;
    e.stopPropagation();
    onSelectNode(highlightNodeId === nodeId ? null : nodeId);
  }

  function handleNodeContextMenu(e: MouseEvent, nodeId: string) {
    e.preventDefault();
    e.stopPropagation();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCtxMenu({ nodeId, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function handleLinkHover(link: MapLink, e: MouseEvent) {
    setHoveredLink(link.id);
    // Only show tooltip for data links — route links have per-waypoint tooltips
    if (link.linkType === "data" && link.dataShares.length > 0) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect) setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top - 10, content: [`Shared: ${link.dataShares.join(", ")}`] });
    }
  }

  function handleLinkLeave() {
    setHoveredLink(null);
    setTooltip(null);
  }

  function handleLinkContextMenu(link: MapLink, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    setCtxMenu(null);
    setLinkCtxMenu({ linkId: link.id, x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  function handleRouteCopy(link: MapLink, reversed: boolean, e: MouseEvent) {
    e.stopPropagation();
    const fromNode = nodeMap.get(link.fromNodeId);
    const toNode = nodeMap.get(link.toNodeId);

    // Separate bookend warps from inter-system hops
    const startWarp = link.waypoints.find((w) => w.waypointType === "warp" && w.fromLpoint);
    const endWarp = link.waypoints.find((w) => w.waypointType === "warp" && w.toLpoint);
    const hops = link.waypoints.filter((w) => w.waypointType !== "warp");
    const orderedHops = reversed ? [...hops].reverse() : hops;

    // Build name→ID lookup from waypoints + nodes
    const idMap = new Map<string, string>();
    for (const wp of hops) {
      if (wp.fromSystemId) idMap.set(wp.fromSystem, wp.fromSystemId);
      if (wp.toSystemId) idMap.set(wp.toSystem, wp.toSystemId);
    }
    if (fromNode?.solarSystemId && fromNode.solarSystemName) idMap.set(fromNode.solarSystemName, fromNode.solarSystemId);
    if (toNode?.solarSystemId && toNode.solarSystemName) idMap.set(toNode.solarSystemName, toNode.solarSystemId);

    // Build ordered system chain
    const chain: { name: string; id?: string }[] = [];
    for (const hp of orderedHops) {
      const from = reversed ? hp.toSystem : hp.fromSystem;
      const to = reversed ? hp.fromSystem : hp.toSystem;
      if (chain.length === 0 && from) chain.push({ name: from, id: idMap.get(from) });
      if (to) chain.push({ name: to, id: idMap.get(to) });
    }

    // Fallback: if no inter-system hops, use endpoint nodes
    if (chain.length === 0) {
      const fName = (reversed ? toNode : fromNode)?.solarSystemName || "?";
      const tName = (reversed ? fromNode : toNode)?.solarSystemName || "?";
      chain.push({ name: fName, id: idMap.get(fName) });
      if (fName !== tName) chain.push({ name: tName, id: idMap.get(tName) });
    }

    // Line 1: title
    const title = `${chain[0].name} → ${chain[chain.length - 1].name}`;

    // Line 2: legend
    const legend = "Gate: (x)→ SmartGate: [SmartGate]→ Jump: <distance>→ Warp: }→(L-Point) | * = potential heat trap";

    // Line 3: autolinked body
    const sysTag = (s: { name: string; id?: string }) =>
      s.id ? `<a href="showinfo:5//${s.id}">${s.name}</a>` : s.name;
    let body = sysTag(chain[0]);
    for (let i = 0; i < orderedHops.length; i++) {
      const hp = orderedHops[i];
      const t = hp.waypointType;
      const sep = t === "jump_gate" ? " (x)→ "
        : t === "smart_gate" ? " [SmartGate]→ "
        : t === "ship_jump" && hp.distance ? ` ${hp.distance}→ `
        : " → ";
      body += sep + sysTag(chain[i + 1]);
    }
    // Ending warp }→(PxLy) — destination L-Point only
    const destLpoint = reversed ? (startWarp?.fromLpoint || "") : (endWarp?.toLpoint || "");
    if (destLpoint) body += ` }→(${destLpoint})`;

    const text = `${title}\n${legend}\n${body}`;
    navigator.clipboard.writeText(text).then(() => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (rect) {
        setCopyNotification({ x: e.clientX - rect.left, y: e.clientY - rect.top });
        setTimeout(() => setCopyNotification(null), 2000);
      }
    });
  }

  // ── Zoom controls ──
  function zoomIn() {
    setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP));
  }
  function zoomOut() {
    setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP));
  }
  function resetView() {
    setPan({ x: 0, y: 0 });
    setZoom(1);
  }

  // ── Render links ──
  function renderLink(link: MapLink) {
    const from = nodeMap.get(link.fromNodeId);
    const to = nodeMap.get(link.toNodeId);
    if (!from || !to) return null;

    const isHighlighted = hoveredLink === link.id ||
      hoveredNode === link.fromNodeId || hoveredNode === link.toNodeId ||
      highlightNodeId === link.fromNodeId || highlightNodeId === link.toNodeId;

    // Parallel offset when both route + data links exist between same pair
    const pairKey = from.id < to.id ? `${from.id}|${to.id}` : `${to.id}|${from.id}`;
    const needsOffset = dualLinkPairs.has(pairKey);
    const ldx = to.mapX - from.mapX;
    const ldy = to.mapY - from.mapY;
    const len = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
    const perpX = -ldy / len;
    const perpY = ldx / len;
    const OFFSET = 6;
    const sign = link.linkType === "data" ? 1 : -1;
    const ox = needsOffset ? perpX * OFFSET * sign : 0;
    const oy = needsOffset ? perpY * OFFSET * sign : 0;

    const x1 = from.mapX + ox, y1 = from.mapY + oy;
    const x2 = to.mapX + ox, y2 = to.mapY + oy;
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;

    if (link.linkType === "data") {
      // Solid green line with midpoint icon showing shared categories
      return (
        <g key={link.id}
          onMouseEnter={(e) => handleLinkHover(link, e)}
          onMouseLeave={handleLinkLeave}
          onContextMenu={(e) => handleLinkContextMenu(link, e)}
        >
          <line
            x1={x1} y1={y1}
            x2={x2} y2={y2}
            stroke={isHighlighted ? COLORS.dataLinkHover : COLORS.dataLink}
            strokeWidth={isHighlighted ? 2.5 : 2}
            style={{ transition: "stroke 0.2s, stroke-width 0.2s" }}
          />
          {/* Wider invisible hit area for hovering */}
          <line
            x1={x1} y1={y1}
            x2={x2} y2={y2}
            stroke="transparent"
            strokeWidth={12}
          />
          {/* Midpoint icon showing shared data categories */}
          {link.dataShares.length > 0 && (
            <DataMidpointIcon x={midX} y={midY} shares={link.dataShares} />
          )}
        </g>
      );
    }

    // Route: dashed chain line with waypoint icons at midpoints
    const dx = x2 - x1;
    const dy = y2 - y1;

    // Direction reversal: if the player is at the TO node, reverse waypoint order
    const shouldReverse = to.ssuId === currentSsuId;
    const orderedWaypoints = shouldReverse ? [...link.waypoints].reverse() : link.waypoints;
    const segCount = Math.max(1, orderedWaypoints.length);

    return (
      <g key={link.id}
        onMouseEnter={(e) => handleLinkHover(link, e)}
        onMouseLeave={handleLinkLeave}
        onClick={(e) => handleRouteCopy(link, shouldReverse, e)}
        onContextMenu={(e) => handleLinkContextMenu(link, e)}
        style={{ cursor: "pointer" }}
      >
        <line
          x1={x1} y1={y1}
          x2={x2} y2={y2}
          stroke={isHighlighted ? COLORS.routeChain : COLORS.routeChainDim}
          strokeWidth={isHighlighted ? 3 : 2}
          strokeDasharray="6 4"
          style={{ transition: "stroke 0.2s" }}
        />
        {/* Wider invisible hit area */}
        <line
          x1={x1} y1={y1}
          x2={x2} y2={y2}
          stroke="transparent"
          strokeWidth={12}
        />
        {/* Per-waypoint icons with individual tooltips */}
        {orderedWaypoints.map((wp, i) => {
          const t = (i + 1) / (segCount + 1);
          const wx = x1 + dx * t;
          const wy = y1 + dy * t;
          const tipFrom = shouldReverse ? wp.toSystem : wp.fromSystem;
          const tipTo = shouldReverse ? wp.fromSystem : wp.toSystem;
          const tipLine = wp.waypointType === "warp"
            ? `Warp: ${wp.fromLpoint || "–"} → ${wp.toLpoint || "–"}`
            : `${waypointLabel(wp.waypointType)}: ${tipFrom} → ${tipTo}${wp.distance ? ` (${wp.distance} LY)` : ""}`;
          return (
            <g key={i}
              onMouseEnter={(e2) => {
                e2.stopPropagation();
                const rect = svgRef.current?.getBoundingClientRect();
                if (rect) setTooltip({ x: e2.clientX - rect.left, y: e2.clientY - rect.top - 10, content: [tipLine] });
              }}
              onMouseLeave={() => setTooltip(null)}
            >
              <circle cx={wx} cy={wy} r={10} fill="transparent" />
              <WaypointIcon type={wp.waypointType} x={wx} y={wy} size={14} />
            </g>
          );
        })}
      </g>
    );
  }

  // ── Render nodes ──
  function renderNode(node: MapNode) {
    const color = nodeColor(node);
    const isSelected = highlightNodeId === node.id;
    const isHovered = hoveredNode === node.id;
    const isCurrent = node.ssuId === currentSsuId;
    const dimmed = isNodeDimmed(node);
    const s = NODE_SIZE;
    const half = s / 2;

    return (
      <g
        key={node.id}
        data-node-id={node.id}
        transform={`translate(${node.mapX}, ${node.mapY})`}
        style={{ cursor: dragging === node.id ? "grabbing" : "pointer" }}
        opacity={dimmed ? 0.3 : 1}
        onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
        onClick={(e) => handleNodeClick(e, node.id)}
        onContextMenu={(e) => handleNodeContextMenu(e, node.id)}
        onMouseEnter={(e) => {
          setHoveredNode(node.id);
          const fuel = fuelBySsuId?.get(node.ssuId);
          if (fuel) {
            const rect = containerRef.current?.getBoundingClientRect();
            const lines = [
              sanitiseLabel(node.label, node.ssuId),
              `Fuel: ${fuel.percent.toFixed(1)}%${fuel.isBurning ? ` — ${fuel.timeRemainingLabel} remaining` : fuel.percent > 0 ? " (offline)" : " (empty)"}`,
            ];
            if (rect) setTooltip({ x: e.clientX - rect.left, y: e.clientY - rect.top - 10, content: lines });
          }
        }}
        onMouseLeave={() => { setHoveredNode(null); setTooltip(null); }}
      >
        {/* Glow ring for selected/hovered */}
        {(isSelected || isHovered) && (
          <rect x={-half - 4} y={-half - 4} width={s + 8} height={s + 8}
            fill="none" stroke={color} strokeWidth={1.5} opacity={0.4} />
        )}
        {/* Current SSU pulse ring */}
        {isCurrent && (
          <rect x={-half - 6} y={-half - 6} width={s + 12} height={s + 12}
            fill="none" stroke={COLORS.currentSsu} strokeWidth={1} opacity={0.3}>
            <animate attributeName="opacity" from="0.3" to="0" dur="2s" repeatCount="indefinite" />
          </rect>
        )}
        {/* Main square */}
        <rect x={-half} y={-half} width={s} height={s}
          fill="var(--color-surface, #141414)" stroke={color}
          strokeWidth={isSelected ? 2.5 : 1.5} />
        {/* Icon */}
        <svg x={-8} y={-8} width={16} height={16} viewBox="0 0 24 24">
          <path d={ICON_PATHS.ssu} fill={color} />
        </svg>
        {/* Label */}
        <text
          y={half + 14}
          textAnchor="middle"
          fill={color}
          fontSize={10}
          fontWeight={isSelected ? 600 : 400}
          style={{ pointerEvents: "none", userSelect: "none" }}
        >
          {sanitiseLabel(node.label, node.ssuId)}
        </text>
        {/* Visibility badge */}
        {node.visibility === "public" && (
          <text x={half + 2} y={-half + 10} fontSize={7} fill={COLORS.universal}
            style={{ pointerEvents: "none" }}>PUB</text>
        )}
      </g>
    );
  }

  return (
    <div className="network-map-container" ref={containerRef}>
      {/* Zoom controls */}
      <div className="network-map-controls">
        <button className="map-ctrl-btn" onClick={zoomIn} title="Zoom in">+</button>
        <button className="map-ctrl-btn" onClick={zoomOut} title="Zoom out">−</button>
        <button className="map-ctrl-btn" onClick={resetView} title="Reset view">⊙</button>
      </div>

      <svg
        ref={svgRef}
        className="network-map-svg"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={() => { if (!dragging) { onSelectNode(null); setCtxMenu(null); } }}
      >
        {/* Background grid */}
        <defs>
          <pattern id="map-grid" width={50 * zoom} height={50 * zoom} patternUnits="userSpaceOnUse"
            x={pan.x % (50 * zoom)} y={pan.y % (50 * zoom)}>
            <line x1={0} y1={0} x2={50 * zoom} y2={0} stroke={COLORS.gridLine} strokeWidth={0.5} />
            <line x1={0} y1={0} x2={0} y2={50 * zoom} stroke={COLORS.gridLine} strokeWidth={0.5} />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#map-grid)" />

        {/* World group */}
        <g transform={`translate(${pan.x}, ${pan.y}) scale(${zoom})`}>
          {/* Links first (behind nodes) */}
          {filteredLinks.map(renderLink)}
          {/* Nodes on top */}
          {filteredNodes.map(renderNode)}
        </g>

        {/* Tooltip overlay (fixed in screen space) */}
        {tooltip && (
          <foreignObject x={tooltip.x + 10} y={tooltip.y - tooltip.content.length * 16 - 8} width={280} height={tooltip.content.length * 18 + 16}>
            <div className="map-tooltip">
              {tooltip.content.map((line, i) => (
                <div key={i}>{line}</div>
              ))}
            </div>
          </foreignObject>
        )}

        {/* Copy notification overlay */}
        {copyNotification && (
          <foreignObject x={copyNotification.x - 50} y={copyNotification.y - 30} width={120} height={30}>
            <div style={{
              background: "rgba(0,200,100,0.9)", color: "#fff", fontSize: "0.7rem", fontWeight: 600,
              borderRadius: 4, padding: "4px 10px", textAlign: "center", pointerEvents: "none",
              whiteSpace: "nowrap",
            }}>
              Route copied!
            </div>
          </foreignObject>
        )}
      </svg>

      {/* ── Link context menu (HTML overlay) ── */}
      {linkCtxMenu && onDeleteLink && (() => {
        const ctxLink = filteredLinks.find((l) => l.id === linkCtxMenu.linkId);
        if (!ctxLink) return null;
        const fNode = nodeMap.get(ctxLink.fromNodeId);
        const tNode = nodeMap.get(ctxLink.toNodeId);
        const linkLabel = ctxLink.linkType === "route" ? "Route" : "Data Link";
        return (
          <div className="map-ctx-menu" style={{ left: linkCtxMenu.x, top: linkCtxMenu.y }}>
            <div className="map-ctx-title" style={{ fontSize: "0.65rem", padding: "4px 8px", opacity: 0.6 }}>
              {linkLabel}: {fNode?.label || "?"} ↔ {tNode?.label || "?"}
            </div>
            {isOwner && (
              <button
                className="map-ctx-item map-ctx-danger"
                onClick={() => { setLinkCtxMenu(null); onDeleteLink(ctxLink.id); }}
              >
                Remove Link
              </button>
            )}
          </div>
        );
      })()}

      {/* ── Node context menu (HTML overlay) ── */}
      {ctxMenu && (() => {
        const ctxNode = nodeMap.get(ctxMenu.nodeId);
        if (!ctxNode) return null;
        const nodeLinks = filteredLinks.filter(
          (l) => l.fromNodeId === ctxMenu.nodeId || l.toNodeId === ctxMenu.nodeId,
        );
        const hasDataLinks = nodeLinks.some((l) => l.linkType === "data" && l.dataShares.length > 0);
        const isCurrent = ctxNode.ssuId === currentSsuId;
        const canLink = isOwner && (!linkableNodeIds || linkableNodeIds.has(ctxMenu.nodeId));
        const canBrowse = hasDataLinks && !isCurrent && (
          !dataReachableNodeIds || dataReachableNodeIds.has(ctxMenu.nodeId)
        );

        return (
          <div
            className="map-ctx-menu"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            {canLink && (
              <button
                className="map-ctx-item"
                onClick={() => { setCtxMenu(null); onStartLink(ctxMenu.nodeId); }}
              >
                + Create Link
              </button>
            )}
            {canBrowse && onBrowseRemote && (
              <button
                className="map-ctx-item"
                onClick={() => { setCtxMenu(null); onBrowseRemote(ctxMenu.nodeId); }}
              >
                Browse Remote
              </button>
            )}
            {isOwner && nodeLinks.length > 0 && onDeleteLink && (
              <button
                className="map-ctx-item map-ctx-danger"
                onClick={() => {
                  setCtxMenu(null);
                  nodeLinks.forEach((l) => onDeleteLink(l.id));
                }}
              >
                Remove All Links ({nodeLinks.length})
              </button>
            )}
            {isOwner && onRemoveNode && (
              <button
                className="map-ctx-item map-ctx-danger"
                onClick={() => { setCtxMenu(null); onRemoveNode(ctxMenu.nodeId); }}
              >
                Remove from Map
              </button>
            )}
          </div>
        );
      })()}

      {filteredNodes.length === 0 && (
        <div className="network-map-empty">
          <p className="muted">No SSUs on the map yet.</p>
          <p className="muted" style={{ fontSize: "0.65rem" }}>Add an SSU from the list below to start building your network.</p>
        </div>
      )}
    </div>
  );
}
