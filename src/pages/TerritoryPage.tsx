import { useState, useMemo, useCallback } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useCharacter } from "../hooks/useCharacter";
import { useGoals } from "../context/GoalContext";
import { useTerritoryData, distance3d, toLightYears, formatLy, type TerritorySSU } from "../hooks/useTerritoryData";
import { useNetworkMap, type MapWaypoint, type LinkType } from "../hooks/useNetworkMap";
import { NetworkMapCanvas, type MapFilter } from "../components/NetworkMap";
import { LinkSetupDialog } from "../components/LinkSetupDialog";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ssuDisplayName, sanitiseLabel, anonSsuName, buildSsuLabel } from "../utils/ssuNames";
import { useTerritoryFuel } from "../hooks/useTerritoryFuel";
import { FuelProgressBar } from "../components/FuelDisplay";
import type { RemoteBrowse } from "../App";
import type { EndpointInfo } from "../components/LinkSetupDialog";

interface TerritoryPageProps {
  onBrowseRemote?: (info: RemoteBrowse) => void;
}

export function TerritoryPage({ onBrowseRemote }: TerritoryPageProps) {
  const account = useCurrentAccount();
  const { data: character } = useCharacter(account?.address);
  const { ssuId, tribeId } = useGoals();
  const { ssus, loading } = useTerritoryData(tribeId, account?.address ?? "", ssuId);
  const { fuelBySsu } = useTerritoryFuel(ssus);
  const {
    nodes, links, loading: mapLoading,
    upsertNode, deleteNode, createLink, deleteLink,
  } = useNetworkMap(tribeId);
  const [selectedSsu, setSelectedSsu] = useState<string | null>(null);
  const [requestStatus, setRequestStatus] = useState<Record<string, string>>({});
  const [mapFilter, setMapFilter] = useState<MapFilter>("all");
  const [highlightNodeId, setHighlightNodeId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  // ── Link creation flow ──
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [linkTo, setLinkTo] = useState<string | null>(null);
  const [showLinkDialog, setShowLinkDialog] = useState(false);
  const [linkTargetPick, setLinkTargetPick] = useState(false);
  const [openDataMenu, setOpenDataMenu] = useState<string | null>(null); // link ID of open data-link menu
  const [externalInput, setExternalInput] = useState("");
  const [externalError, setExternalError] = useState<string | null>(null);

  const requestAccess = useMutation({
    mutationFn: async (targetSsuId: string) => {
      const res = await fetch(
        `/api/location-requests?ssuId=${encodeURIComponent(targetSsuId)}&tribeId=${encodeURIComponent(tribeId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            requesterAddress: account?.address ?? "",
            requesterName: character?.name ?? "",
            requesterSsuId: ssuId,
          }),
        },
      );
      return res.json();
    },
    onSuccess: (data, targetSsuId) => {
      setRequestStatus((prev) => ({ ...prev, [targetSsuId]: data.status ?? "pending" }));
      queryClient.invalidateQueries({ queryKey: ["tribe-locations"] });
    },
  });

  const currentSsu = ssus.find((s) => s.ssuId === ssuId);
  const currentSolarSystem = currentSsu?.solarSystemName ?? null;
  const walletAddr = account?.address ?? "";
  const isOwner = !!currentSsu && currentSsu.activatedBy.toLowerCase() === walletAddr.toLowerCase();

  // Set of SSU IDs already on the map
  const nodesOnMap = useMemo(() => new Set(nodes.map((n) => n.ssuId)), [nodes]);

  // Set of SSU IDs the current wallet actually operates
  const ownedSsuIds = useMemo(() => new Set(
    ssus.filter((s) => s.activatedBy.toLowerCase() === walletAddr.toLowerCase()).map((s) => s.ssuId),
  ), [ssus, walletAddr]);

  // Set of SSU IDs where location has been shared / granted
  const locationGrantedSsuIds = useMemo(() => new Set(
    ssus.filter((s) => s.locationGranted).map((s) => s.ssuId),
  ), [ssus]);

  // ── Linkable nodes: current SSU + owned SSUs reachable via data links (must have location) ──
  const linkableNodeIds = useMemo(() => {
    const currentNode = nodes.find((n) => n.ssuId === ssuId);
    if (!currentNode) return new Set<string>();
    // BFS through data links from the current node, only to owned nodes
    const reachable = new Set<string>([currentNode.id]);
    const queue = [currentNode.id];
    while (queue.length > 0) {
      const nid = queue.shift()!;
      for (const link of links) {
        if (link.linkType !== "data") continue;
        const neighbor = link.fromNodeId === nid ? link.toNodeId : link.toNodeId === nid ? link.fromNodeId : null;
        if (!neighbor || reachable.has(neighbor)) continue;
        const neighborNode = nodes.find((n) => n.id === neighbor);
        if (neighborNode && ownedSsuIds.has(neighborNode.ssuId)) {
          reachable.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    // Exclude nodes whose SSU has no location granted
    const result = new Set<string>();
    for (const nodeId of reachable) {
      const n = nodes.find((nd) => nd.id === nodeId);
      if (n && locationGrantedSsuIds.has(n.ssuId)) result.add(nodeId);
    }
    return result;
  }, [nodes, links, ssus, ssuId, walletAddr, locationGrantedSsuIds]);

  // ── Browsable nodes: all nodes reachable from current SSU via data links (any ownership) ──
  const dataReachableNodeIds = useMemo(() => {
    const currentNode = nodes.find((n) => n.ssuId === ssuId);
    if (!currentNode) return new Set<string>();
    const reachable = new Set<string>([currentNode.id]);
    const queue = [currentNode.id];
    while (queue.length > 0) {
      const nid = queue.shift()!;
      for (const link of links) {
        if (link.linkType !== "data") continue;
        const neighbor = link.fromNodeId === nid ? link.toNodeId : link.toNodeId === nid ? link.fromNodeId : null;
        if (!neighbor || reachable.has(neighbor)) continue;
        reachable.add(neighbor);
        queue.push(neighbor);
      }
    }
    // Remove the current node itself — can't "browse" your own SSU remotely
    reachable.delete(currentNode.id);
    return reachable;
  }, [nodes, links, ssuId]);

  // ── Filter SSU list based on active filter tab ──
  const filteredSsus = useMemo(() => {
    return ssus.filter((ssu) => {
      if (mapFilter === "owned") return ssu.activatedBy.toLowerCase() === walletAddr.toLowerCase();
      if (mapFilter === "tribe") return !!ssu.isTribeMember;
      if (mapFilter === "universal") return ssu.visibility === "public" || ssu.visibility === "external" || ssu.isExternal;
      // "all" shows everything
      return true;
    });
  }, [ssus, mapFilter, walletAddr]);

  // ── Add to map ──
  // Build a lookup from SSU ID → best display name.
  // Priority: hubName from territory data (synced from on-chain) > map node label > anon
  const ssuMapLabels = useMemo(() => {
    const m = new Map<string, string>();
    // Seed with map node labels as fallback
    for (const n of nodes) {
      if (n.label) m.set(n.ssuId, sanitiseLabel(n.label, n.ssuId));
    }
    // Override with hubName from territory data (synced from on-chain Metadata)
    for (const s of ssus) {
      const display = ssuDisplayName(s);
      if (display && !display.startsWith("SSU-")) m.set(s.ssuId, display);
    }
    return m;
  }, [nodes, ssus]);

  // Enrich map nodes with hubName-derived labels for the network map canvas
  const enrichedNodes = useMemo(() => {
    return nodes.map((n) => {
      const best = ssuMapLabels.get(n.ssuId);
      if (best && best !== sanitiseLabel(n.label, n.ssuId)) {
        return { ...n, label: best };
      }
      return n;
    });
  }, [nodes, ssuMapLabels]);

  const handleAddToMap = useCallback((ssu: TerritorySSU) => {
    if (!account) return;
    const jitterX = (Math.random() - 0.5) * 200;
    const jitterY = (Math.random() - 0.5) * 200;
    upsertNode.mutate({
      id: crypto.randomUUID(),
      ssuId: ssu.ssuId,
      tribeId,
      label: ssuDisplayName(ssu),
      mapX: 300 + jitterX,
      mapY: 200 + jitterY,
      visibility: ssu.isExternal ? "external" : ssu.visibility === "public" ? "public" : "tribal",
      addedBy: account.address,
      solarSystemName: ssu.solarSystemName ?? "",
      solarSystemId: ssu.solarSystemId ?? "",
      pNum: ssu.pNum ?? "",
      lNum: ssu.lNum ?? "",
    });
  }, [account, tribeId, upsertNode]);

  // ── Remove single SSU from map ──
  function handleRemoveFromMap(targetSsuId: string) {
    const node = nodes.find((n) => n.ssuId === targetSsuId);
    if (node) deleteNode.mutate(node.id);
  }

  // ── Node moved on map (drag end) ──
  function handleMoveNode(nodeId: string, x: number, y: number) {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node) return;
    upsertNode.mutate({ ...node, mapX: x, mapY: y });
  }

  // ── Start link flow (restricted to linkable nodes with location) ──
  function handleStartLink(nodeId: string) {
    if (!linkableNodeIds.has(nodeId)) return;
    const node = nodes.find((n) => n.id === nodeId);
    if (node && !locationGrantedSsuIds.has(node.ssuId)) return;
    setLinkFrom(nodeId);
    setLinkTargetPick(true);
  }

  // ── Node selected on map ──
  function handleSelectNode(nodeId: string | null) {
    if (linkTargetPick && nodeId && nodeId !== linkFrom) {
      // Block linking to SSUs without location granted
      const targetNode = nodes.find((n) => n.id === nodeId);
      if (targetNode && !locationGrantedSsuIds.has(targetNode.ssuId)) return;
      setLinkTo(nodeId);
      setLinkTargetPick(false);
      setShowLinkDialog(true);
      return;
    }
    setHighlightNodeId(nodeId);
    if (nodeId) {
      const node = nodes.find((n) => n.id === nodeId);
      if (node) setSelectedSsu(node.ssuId);
    }
  }

  // ── Link confirmed ──
  function handleLinkConfirm(params: {
    linkType: LinkType;
    waypoints: MapWaypoint[];
    dataShares: string[];
    fromEndpoint?: EndpointInfo;
    toEndpoint?: EndpointInfo;
    rawRoute?: string;
  }) {
    if (!linkFrom || !linkTo || !account) return;
    createLink.mutate({
      id: crypto.randomUUID(),
      fromNodeId: linkFrom,
      toNodeId: linkTo,
      linkType: params.linkType,
      createdBy: account.address,
      waypoints: params.waypoints,
      dataShares: params.dataShares,
      rawRoute: params.rawRoute,
    });

    // Progressive naming + persist L-Point data: upgrade node labels and store pNum/lNum/solarSystemName
    if (params.fromEndpoint) {
      const fNode = nodes.find((n) => n.id === linkFrom);
      if (fNode) {
        const newLabel = buildSsuLabel(params.fromEndpoint);
        upsertNode.mutate({
          ...fNode,
          label: newLabel || fNode.label,
          solarSystemName: params.fromEndpoint.system || fNode.solarSystemName || "",
          solarSystemId: params.fromEndpoint.systemId || fNode.solarSystemId || "",
          pNum: params.fromEndpoint.pNum || fNode.pNum || "",
          lNum: params.fromEndpoint.lNum || fNode.lNum || "",
        });
      }
    }
    if (params.toEndpoint) {
      const tNode = nodes.find((n) => n.id === linkTo);
      if (tNode) {
        const newLabel = buildSsuLabel(params.toEndpoint);
        upsertNode.mutate({
          ...tNode,
          label: newLabel || tNode.label,
          solarSystemName: params.toEndpoint.system || tNode.solarSystemName || "",
          solarSystemId: params.toEndpoint.systemId || tNode.solarSystemId || "",
          pNum: params.toEndpoint.pNum || tNode.pNum || "",
          lNum: params.toEndpoint.lNum || tNode.lNum || "",
        });
      }
    }

    setShowLinkDialog(false);
    setLinkFrom(null);
    setLinkTo(null);
  }

  function handleLinkCancel() {
    setShowLinkDialog(false);
    setLinkFrom(null);
    setLinkTo(null);
    setLinkTargetPick(false);
  }

  // ── Also allow linking from the list (restricted to linkable nodes) ──
  function handleListLink(targetSsuId: string) {
    const node = nodes.find((n) => n.ssuId === targetSsuId);
    if (!node) return;
    // Block linking to/from SSUs without location granted
    if (!locationGrantedSsuIds.has(targetSsuId)) return;
    if (!linkFrom) {
      if (!linkableNodeIds.has(node.id)) return;
      handleStartLink(node.id);
    } else if (linkFrom && node.id !== linkFrom) {
      setLinkTo(node.id);
      setLinkTargetPick(false);
      setShowLinkDialog(true);
    }
  }

  // ── Remove node from map (by nodeId, for map context menu) ──
  function handleRemoveNodeById(nodeId: string) {
    deleteNode.mutate(nodeId);
  }

  // ── Browse remote SSU from map context menu ──
  function handleBrowseFromMap(nodeId: string) {
    const node = nodes.find((n) => n.id === nodeId);
    if (!node || !onBrowseRemote) return;
    // Must be reachable from current SSU via a connected data-link network
    if (!dataReachableNodeIds.has(nodeId)) return;
    // Find data links connected to this node
    const nodeLinks = links.filter(
      (l) => (l.fromNodeId === nodeId || l.toNodeId === nodeId) && l.linkType === "data" && l.dataShares.length > 0,
    );
    if (nodeLinks.length === 0) return;
    // Merge all shared categories from all data links
    const allCats = [...new Set(nodeLinks.flatMap((l) => l.dataShares))];
    const firstPage = allCats.includes("goals") ? "home" as const
      : allCats.includes("market") || allCats.includes("inventory") ? "market" as const
      : "exchange" as const;
    const ssuEntry = ssus.find((s) => s.ssuId === node.ssuId);
    const owned = !!ssuEntry && ssuEntry.activatedBy.toLowerCase() === walletAddr.toLowerCase();
    onBrowseRemote({
      ssuId: node.ssuId,
      label: sanitiseLabel(node.label, node.ssuId),
      allowedCategories: allCats,
      initialPage: owned ? "tribe" as const : firstPage,
      isOwned: owned,
      locationGranted: !!ssuEntry?.locationGranted,
    });
  }

  const FILTER_TABS: { key: MapFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "tribe", label: "Tribe" },
    { key: "owned", label: "Owned" },
    { key: "universal", label: "Universal" },
  ];

  // ── Add external SSU ──
  async function handleAddExternal() {
    const addr = externalInput.trim();
    if (!addr) return;
    if (!addr.startsWith("0x") || addr.length < 10) {
      setExternalError("Enter a valid SSU address (0x...)");
      return;
    }
    if (ssus.some((s) => s.ssuId === addr)) {
      setExternalError("This SSU is already in your territory");
      return;
    }
    setExternalError(null);
    try {
      const res = await fetch(
        `/api/external-ssus?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ externalSsuId: addr, addedBy: account?.address ?? "" }),
        },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setExternalError((err as { error?: string }).error ?? "Failed to add");
        return;
      }
      setExternalInput("");
      queryClient.invalidateQueries({ queryKey: ["tribe-locations"] });
    } catch {
      setExternalError("Network error");
    }
  }

  // ── Remove external SSU ──
  async function handleRemoveExternal(externalSsuId: string) {
    try {
      await fetch(
        `/api/external-ssus?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(tribeId)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ externalSsuId }),
        },
      );
      queryClient.invalidateQueries({ queryKey: ["tribe-locations"] });
      queryClient.invalidateQueries({ queryKey: ["network-map"] });
      if (selectedSsu === externalSsuId) setSelectedSsu(null);
    } catch { /* best-effort */ }
  }

  if (loading || mapLoading) {
    return <div className="page-single"><section className="panel"><p className="muted">Loading territory data…</p></section></div>;
  }

  const fromNode = linkFrom ? nodes.find((n) => n.id === linkFrom) : null;
  const toNode = linkTo ? nodes.find((n) => n.id === linkTo) : null;

  return (
    <div className="page-single">
      {/* ═══ Network Map Widget ═══ */}
      <section className="panel">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.35rem" }}>
          <h3 style={{ margin: 0 }}>Network Map</h3>
          <div className="map-legend">
            <span className="legend-item"><span className="legend-swatch" style={{ background: "#00CCFF" }} />You</span>
            <span className="legend-item"><span className="legend-swatch" style={{ background: "#FF6600" }} />Owned</span>
            <span className="legend-item"><span className="legend-swatch" style={{ background: "#7B68EE" }} />Tribe</span>
            <span className="legend-item"><span className="legend-swatch" style={{ background: "#33CC66" }} />Public</span>
          </div>
        </div>
        {linkTargetPick && (
          <p className="map-pick-hint">Click a second SSU on the map or in the list to create a link…</p>
        )}
        <NetworkMapCanvas
          nodes={enrichedNodes}
          links={links}
          currentSsuId={ssuId}
          currentSolarSystem={currentSolarSystem}
          walletAddress={walletAddr}
          ownedSsuIds={ownedSsuIds}
          filter={mapFilter}
          highlightNodeId={highlightNodeId}
          linkableNodeIds={linkableNodeIds}
          onSelectNode={handleSelectNode}
          onMoveNode={handleMoveNode}
          onStartLink={handleStartLink}
          onRemoveNode={handleRemoveNodeById}
          onDeleteLink={(linkId) => deleteLink.mutate(linkId)}
          onBrowseRemote={handleBrowseFromMap}
          dataReachableNodeIds={dataReachableNodeIds}
          isOwner={isOwner}
          fuelBySsuId={fuelBySsu}
        />
      </section>

      {/* ═══ Filter Tabs — filter the LIST, not the map ═══ */}
      <div className="map-filter-tabs">
        {FILTER_TABS.map((t) => (
          <button
            key={t.key}
            className={`map-filter-tab${mapFilter === t.key ? " active" : ""}`}
            onClick={() => setMapFilter(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ═══ Territory SSU List ═══ */}
      <section className="panel">
        <h3>Territory Overview</h3>
        <p className="muted" style={{ fontSize: "0.72rem", marginBottom: "0.75rem" }}>
          SSUs in your territory. Universal includes public SSUs from all tribes and manually-added external assemblies.
        </p>

        {/* Add external SSU input */}
        {isOwner && (
        <>
        <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.75rem", alignItems: "center" }}>
          <input
            type="text"
            placeholder="Paste external SSU address (0x...)"
            value={externalInput}
            onChange={(e) => { setExternalInput(e.target.value); setExternalError(null); }}
            style={{ flex: 1, fontSize: "0.75rem" }}
          />
          <button
            className="btn-primary"
            disabled={!externalInput.trim()}
            onClick={handleAddExternal}
            style={{ whiteSpace: "nowrap", fontSize: "0.75rem", padding: "0.35rem 0.7rem" }}
          >
            + Add External
          </button>
        </div>
        {externalError && <p className="error" style={{ fontSize: "0.72rem", marginTop: "-0.5rem", marginBottom: "0.5rem" }}>{externalError}</p>}
        </>
        )}

        {filteredSsus.length === 0 ? (
          <p className="muted" style={{ fontStyle: "italic" }}>No SSUs match the current filter.</p>
        ) : (
          <div className="territory-grid">
            <div className="territory-header">
              <span>SSU</span>
              <span>Operator</span>
              <span>Location</span>
              <span>Distance</span>
              <span>Fuel</span>
              <span></span>
            </div>

            {filteredSsus.map((ssu) => {
              const isCurrentSsu = ssu.ssuId === ssuId;
              const dist = computeDistance(currentSsu, ssu);
              const reqStat = requestStatus[ssu.ssuId];
              const onMap = nodesOnMap.has(ssu.ssuId);

              return (
                <div
                  key={ssu.ssuId}
                  className={`territory-row${isCurrentSsu ? " territory-row-current" : ""}${selectedSsu === ssu.ssuId ? " territory-row-selected" : ""}`}
                  onClick={() => setSelectedSsu(selectedSsu === ssu.ssuId ? null : ssu.ssuId)}
                >
                  <span className="territory-cell territory-cell-name">
                    <span className="territory-ssu-name">{ssuMapLabels.get(ssu.ssuId) || ssuDisplayName(ssu)}</span>
                    <span className="territory-badges">
                      {isCurrentSsu && <span className="territory-badge">Current</span>}
                      {onMap && <span className="territory-badge territory-badge-map">Map</span>}
                      {ssu.isExternal && <span className="territory-badge" style={{ background: "#33CC66", color: "#000" }}>External</span>}
                    </span>
                  </span>
                  <span className="territory-cell">
                    {ssu.characterName || <span className="muted">Unknown</span>}
                  </span>
                  <span className="territory-cell">
                    {ssu.locationGranted && ssu.solarSystemName
                      ? ssu.solarSystemName
                      : ssu.hasLocation
                        ? <span className="muted">Restricted</span>
                        : <span className="muted">Not set</span>
                    }
                  </span>
                  <span className="territory-cell">
                    {dist !== null ? formatLy(dist) : "—"}
                  </span>
                  <span className="territory-cell">
                    {(() => {
                      const fuel = fuelBySsu.get(ssu.ssuId);
                      if (!fuel) return <span className="muted">—</span>;
                      return <FuelProgressBar percent={fuel.percent} msRemaining={fuel.msRemaining} compact />;
                    })()}
                  </span>
                  <span className="territory-cell territory-actions">
                    {isOwner && !onMap && (
                      <button
                        className="btn-subtle btn-sm-network"
                        onClick={(e) => { e.stopPropagation(); handleAddToMap(ssu); }}
                        title="Add to network map"
                      >
                        + Map
                      </button>
                    )}
                    {isOwner && onMap && (
                      <>
                        <button
                          className="btn-subtle btn-sm-network"
                          onClick={(e) => { e.stopPropagation(); handleListLink(ssu.ssuId); }}
                          title={!ssu.locationGranted ? "Location not shared — request access first" : linkTargetPick ? "Select as link target" : "Start creating a link"}
                          disabled={!ssu.locationGranted}
                        >
                          {linkTargetPick ? "→ Link" : "Link"}
                        </button>
                        <button
                          className="btn-subtle btn-sm-network btn-danger-subtle"
                          onClick={(e) => { e.stopPropagation(); handleRemoveFromMap(ssu.ssuId); }}
                          title="Remove from map"
                        >
                          −
                        </button>
                      </>
                    )}
                    {!isCurrentSsu && ssu.hasLocation && !ssu.locationGranted && (
                      reqStat ? (
                        <span className={`request-status request-status-${reqStat}`}>{reqStat}</span>
                      ) : (
                        <button
                          className="btn-subtle btn-sm-network"
                          onClick={(e) => {
                            e.stopPropagation();
                            requestAccess.mutate(ssu.ssuId);
                          }}
                          disabled={requestAccess.isPending}
                        >
                          Request Access
                        </button>
                      )
                    )}
                    {isOwner && ssu.isExternal && (
                      <button
                        className="btn-subtle btn-sm-network btn-danger-subtle"
                        onClick={(e) => { e.stopPropagation(); handleRemoveExternal(ssu.ssuId); }}
                        title="Remove external SSU (breaks links and revokes location data)"
                      >
                        ✕
                      </button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Detail panel for selected SSU */}
      {selectedSsu && (() => {
        const ssu = ssus.find((s) => s.ssuId === selectedSsu);
        if (!ssu) return null;
        const dist = computeDistance(currentSsu, ssu);
        const nodeForSsu = nodes.find((n) => n.ssuId === selectedSsu);
        const connectedLinks = nodeForSsu
          ? links.filter((l) => l.fromNodeId === nodeForSsu.id || l.toNodeId === nodeForSsu.id)
          : [];

        return (
          <section className="panel">
            <h3>{ssuDisplayName(ssu)}</h3>
            <div className="territory-detail-grid">
              <div className="setup-field">
                <span className="setup-label">Identifier</span>
                <span className="setup-value">{ssuDisplayName(ssu)}</span>
              </div>
              <div className="setup-field">
                <span className="setup-label">Operator</span>
                <span className="setup-value">{ssu.characterName || <span className="muted">Unknown</span>}</span>
              </div>
              <div className="setup-field">
                <span className="setup-label">Visibility</span>
                <span className="setup-value" style={{ textTransform: "capitalize" }}>{ssu.visibility}</span>
              </div>
              {ssu.locationGranted && ssu.locationX !== null && (
                <>
                  <div className="setup-field">
                    <span className="setup-label">Coordinates</span>
                    <span className="setup-value mono-sm">
                      {ssu.locationX?.toFixed(0)}, {ssu.locationY?.toFixed(0)}, {ssu.locationZ?.toFixed(0)}
                    </span>
                  </div>
                  {dist !== null && (
                    <div className="setup-field">
                      <span className="setup-label">Distance</span>
                      <span className="setup-value">{formatLy(dist)}</span>
                    </div>
                  )}
                </>
              )}
              {(() => {
                const fuel = fuelBySsu.get(ssu.ssuId);
                if (!fuel) return null;
                const isLow = isFinite(fuel.msRemaining) && fuel.msRemaining > 0 && fuel.msRemaining < 24 * 60 * 60 * 1000;
                return (
                  <div className="setup-field">
                    <span className="setup-label">Network Node Fuel</span>
                    <span className="setup-value" style={{ flexDirection: "column", alignItems: "stretch", gap: "0.25rem" }}>
                      <FuelProgressBar percent={fuel.percent} msRemaining={fuel.msRemaining} compact />
                      <span style={{ fontSize: "0.68rem", color: isLow ? "#e53e3e" : undefined }}>
                        {fuel.isBurning
                          ? `${fuel.percent.toFixed(1)}% — ${fuel.timeRemainingLabel} remaining`
                          : fuel.quantity > 0 ? "Offline" : "Empty"}
                        {isLow && fuel.isBurning && " ⚠"}
                      </span>
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Map action buttons */}
            {isOwner && nodeForSsu && (
              <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem" }}>
                <button
                  className="btn-subtle btn-sm-network"
                  onClick={() => handleListLink(ssu.ssuId)}
                  title={ssu.locationGranted ? "Create a link from this SSU" : "Location not shared — request access first"}
                  disabled={!ssu.locationGranted}
                >
                  + Link
                </button>
                <button
                  className="btn-subtle btn-sm-network btn-danger-subtle"
                  onClick={() => handleRemoveFromMap(ssu.ssuId)}
                  title="Remove from map (also removes all its links)"
                >
                  Remove from Map
                </button>
              </div>
            )}

            {/* Connected links */}
            {connectedLinks.length > 0 && (
              <div style={{ marginTop: "0.75rem" }}>
                <h4 style={{ fontSize: "0.8rem", marginBottom: "0.35rem" }}>Connections</h4>
                {connectedLinks.map((link) => {
                  const otherNodeId = link.fromNodeId === nodeForSsu!.id ? link.toNodeId : link.fromNodeId;
                  const otherNode = nodes.find((n) => n.id === otherNodeId);
                  const otherSsu = ssus.find((s) => s.ssuId === otherNode?.ssuId);
                  const otherLabel = otherSsu ? ssuDisplayName(otherSsu) : (otherNode ? sanitiseLabel(otherNode.label, otherNode.ssuId) : anonSsuName(otherNodeId));
                  const isDataLink = link.linkType === "data";
                  const menuOpen = openDataMenu === link.id;
                  // Only allow browsing if the other node is reachable from the current SSU via data links
                  const otherReachable = otherNode ? dataReachableNodeIds.has(otherNode.id) : false;

                  return (
                    <div key={link.id} className="connection-row-wrap">
                      <div className="connection-row">
                        <span className={`connection-type connection-type-${link.linkType}`}>
                          {isDataLink ? "◇ Data" : "⛓ Route"}
                        </span>
                        <span className="connection-target">
                          → {otherLabel}
                        </span>
                        {isDataLink && link.dataShares.length > 0 && otherReachable && (
                          <button
                            className="btn-subtle btn-sm-network"
                            onClick={() => setOpenDataMenu(menuOpen ? null : link.id)}
                            title="Browse this SSU's shared data"
                          >
                            Browse ▾
                          </button>
                        )}
                        {isOwner && (
                          <button
                            className="btn-subtle btn-sm-network btn-danger-subtle"
                            onClick={() => deleteLink.mutate(link.id)}
                            title="Remove link"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                      {/* Data link browse dropdown */}
                      {isDataLink && menuOpen && otherNode && (
                        <div className="data-link-menu">
                          {link.dataShares.map((cat) => {
                            const page = cat === "goals" ? "home" as const
                              : cat === "market" || cat === "inventory" ? "market" as const
                              : "exchange" as const;
                            const label = cat === "goals" ? "Goals"
                              : cat === "market" ? "Market"
                              : cat === "inventory" ? "Inventory"
                              : cat.charAt(0).toUpperCase() + cat.slice(1);
                            return (
                              <button
                                key={cat}
                                className="data-link-menu-btn"
                                onClick={() => {
                                  setOpenDataMenu(null);
                                  const remoteSsu = ssus.find((s) => s.ssuId === otherNode.ssuId);
                                  const remoteOwned = !!remoteSsu && remoteSsu.activatedBy.toLowerCase() === walletAddr.toLowerCase();
                                  onBrowseRemote?.({
                                    ssuId: otherNode.ssuId,
                                    label: otherLabel,
                                    allowedCategories: link.dataShares,
                                    initialPage: remoteOwned ? "tribe" as const : page,
                                    isOwned: remoteOwned,
                                    locationGranted: !!remoteSsu?.locationGranted,
                                  });
                                }}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })()}

      {/* ═══ Link Setup Dialog ═══ */}
      {showLinkDialog && fromNode && toNode && (() => {
        const pairLinks = links.filter((l) =>
          (l.fromNodeId === linkFrom && l.toNodeId === linkTo) ||
          (l.fromNodeId === linkTo && l.toNodeId === linkFrom),
        );
        const existingTypes = new Set(pairLinks.map((l) => l.linkType));
        return (
          <LinkSetupDialog
            fromNode={fromNode}
            toNode={toNode}
            existingLinkTypes={existingTypes}
            onConfirm={handleLinkConfirm}
            onCancel={handleLinkCancel}
          />
        );
      })()}
    </div>
  );
}

function computeDistance(from: TerritorySSU | undefined, to: TerritorySSU): number | null {
  if (
    !from || !to ||
    from.locationX == null || from.locationY == null || from.locationZ == null ||
    to.locationX == null || to.locationY == null || to.locationZ == null ||
    !from.locationGranted || !to.locationGranted
  ) {
    return null;
  }
  if (from.ssuId === to.ssuId) return 0;
  const d = distance3d(from.locationX, from.locationY, from.locationZ, to.locationX, to.locationY, to.locationZ);
  return toLightYears(d);
}
