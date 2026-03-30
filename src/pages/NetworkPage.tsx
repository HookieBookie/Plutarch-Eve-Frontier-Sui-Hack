import { useState } from "react";
import { abbreviateAddress } from "@evefrontier/dapp-kit";
import { useNetworkSettings } from "../hooks/useNetworkSettings";
import { useLocationRequests, type LocationRequest } from "../hooks/useLocationRequests";
import { anonSsuName } from "../utils/ssuNames";
import { useTicker } from "../context/DeploymentContext";

export function NetworkPage() {
  const { settings, loading: settingsLoading, updateSettings } = useNetworkSettings();
  const { requests, loading: reqLoading, performAction } = useLocationRequests();
  const [whitelistInput, setWhitelistInput] = useState("");
  const ticker = useTicker();

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const resolvedRequests = requests.filter((r) => r.status !== "pending");

  if (settingsLoading) {
    return <div className="page-single"><section className="panel"><p className="muted">Loading network settings…</p></section></div>;
  }

  if (!settings) {
    return <div className="page-single"><section className="panel"><p className="muted">No settings available.</p></section></div>;
  }

  return (
    <div className="page-single">
      {/* ── Visibility Settings ── */}
      <section className="panel">
        <h3>SSU Visibility</h3>
        <p className="muted" style={{ fontSize: "0.72rem", marginBottom: "0.75rem" }}>
          Control who can see the goals, exchange, and market data on this SSU.
        </p>
        <div className="network-radio-group">
          {(["public", "tribal", "private"] as const).map((v) => (
            <label key={v} className="network-radio-label">
              <input
                type="radio"
                name="visibility"
                value={v}
                checked={settings.visibility === v}
                onChange={() => updateSettings.mutate({ visibility: v, locationPolicy: settings.locationPolicy })}
              />
              <div>
                <strong style={{ textTransform: "capitalize" }}>{v}</strong>
                <span className="muted" style={{ display: "block", fontSize: "0.65rem" }}>
                  {v === "public" && "Anyone can see SSU data."}
                  {v === "tribal" && "Only tribe members can see SSU data."}
                  {v === "private" && "Only you (the owner) can see SSU data."}
                </span>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* ── Location Sharing Policy ── */}
      <section className="panel">
        <h3>Location Sharing</h3>
        <p className="muted" style={{ fontSize: "0.72rem", marginBottom: "0.75rem" }}>
          How should location access requests from other SSUs be handled?
        </p>
        <div className="network-radio-group">
          {(["manual", "auto-accept", "auto-deny", "whitelist"] as const).map((p) => (
            <label key={p} className="network-radio-label">
              <input
                type="radio"
                name="locationPolicy"
                value={p}
                checked={settings.locationPolicy === p}
                onChange={() => updateSettings.mutate({ visibility: settings.visibility, locationPolicy: p })}
              />
              <div>
                <strong>
                  {p === "manual" && "Manual Review"}
                  {p === "auto-accept" && "Auto-Accept"}
                  {p === "auto-deny" && "Auto-Deny"}
                  {p === "whitelist" && "Whitelist Only"}
                </strong>
                <span className="muted" style={{ display: "block", fontSize: "0.65rem" }}>
                  {p === "manual" && "You review and approve/deny each request."}
                  {p === "auto-accept" && "All requests are automatically approved."}
                  {p === "auto-deny" && "All requests are automatically denied."}
                  {p === "whitelist" && "Only requests from whitelisted SSUs are auto-approved; others require manual review."}
                </span>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* ── SSU Budget Info ── */}
      <section className="panel">
        <h3>SSU Budget</h3>
        <p className="muted" style={{ fontSize: "0.72rem", marginBottom: "0.75rem" }}>
          This SSU's budget is tracked by its own deposits. Deposit EVE on the Tribe Overview tab to
          increase this SSU's allocatable budget. Only {ticker} deposited from this SSU can be used for goals.
        </p>
        <div className="stat-grid" style={{ marginBottom: "0.5rem" }}>
          <div className="stat">
            <span className="stat-label">SSU Deposited</span>
            <span className="stat-value">{(settings.localBudget ?? 0).toLocaleString()} {ticker}</span>
          </div>
        </div>
      </section>

      {/* ── Whitelist (visible when whitelist policy is selected) ── */}
      {settings.locationPolicy === "whitelist" && (
        <section className="panel">
          <h3>Whitelisted SSUs</h3>
          <p className="muted" style={{ fontSize: "0.72rem", marginBottom: "0.5rem" }}>
            Requests from these SSUs will be automatically approved.
          </p>
          {settings.whitelist.length === 0 ? (
            <p className="muted" style={{ fontSize: "0.7rem", fontStyle: "italic" }}>No SSUs whitelisted yet.</p>
          ) : (
            <ul className="network-list">
              {settings.whitelist.map((wlSsuId) => (
                <li key={wlSsuId} className="network-list-item">
                  <span>{anonSsuName(wlSsuId)}</span>
                  <button
                    className="btn-subtle btn-danger-text"
                    onClick={() => performAction.mutate({ action: "whitelist-remove", whitelistedSsuId: wlSsuId })}
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="network-add-row">
            <input
              type="text"
              className="setup-input"
              placeholder="SSU address to whitelist (0x…)"
              value={whitelistInput}
              onChange={(e) => setWhitelistInput(e.target.value)}
              style={{ flex: 1 }}
            />
            <button
              className="btn-primary"
              disabled={!whitelistInput.trim()}
              onClick={() => {
                performAction.mutate({ action: "whitelist-add", whitelistedSsuId: whitelistInput.trim() });
                setWhitelistInput("");
              }}
              style={{ fontSize: "0.78rem", padding: "0.35rem 0.75rem" }}
            >
              Add
            </button>
          </div>
        </section>
      )}

      {/* ── Pending Location Requests ── */}
      <section className="panel">
        <h3>
          Location Requests
          {pendingRequests.length > 0 && (
            <span className="badge-count">{pendingRequests.length}</span>
          )}
        </h3>
        {reqLoading ? (
          <p className="muted">Loading…</p>
        ) : pendingRequests.length === 0 ? (
          <p className="muted" style={{ fontSize: "0.7rem", fontStyle: "italic" }}>No pending requests.</p>
        ) : (
          <ul className="network-list">
            {pendingRequests.map((r) => (
              <RequestItem key={r.id} request={r} onAction={(action, extra) => performAction.mutate({ action, requestId: r.id, ...extra })} />
            ))}
          </ul>
        )}
      </section>

      {/* ── Access Grants ── */}
      <section className="panel">
        <h3>Location Access Grants</h3>
        <p className="muted" style={{ fontSize: "0.72rem", marginBottom: "0.5rem" }}>
          Users with granted access can see this SSU's coordinates.
        </p>
        {settings.grants.length === 0 ? (
          <p className="muted" style={{ fontSize: "0.7rem", fontStyle: "italic" }}>No grants yet.</p>
        ) : (
          <ul className="network-list">
            {settings.grants.map((wallet) => (
              <li key={wallet} className="network-list-item">
                <span className="mono-sm">{abbreviateAddress(wallet)}</span>
                <button
                  className="btn-subtle btn-danger-text"
                  onClick={() => performAction.mutate({ action: "revoke", wallet })}
                >
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Blocked ── */}
      <section className="panel">
        <h3>Blocked</h3>
        {settings.blocked.length === 0 ? (
          <p className="muted" style={{ fontSize: "0.7rem", fontStyle: "italic" }}>No blocked users or SSUs.</p>
        ) : (
          <ul className="network-list">
            {settings.blocked.map((b, i) => (
              <li key={i} className="network-list-item">
                <span className="mono-sm">
                  {b.address ? `User: ${abbreviateAddress(b.address)}` : `SSU: ${anonSsuName(b.blockedSsuId!)}`}
                </span>
                <button
                  className="btn-subtle"
                  onClick={() => performAction.mutate({ action: "unblock", address: b.address, blockedSsuId: b.blockedSsuId })}
                >
                  Unblock
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Request History ── */}
      {resolvedRequests.length > 0 && (
        <section className="panel">
          <h3>Request History</h3>
          <ul className="network-list">
            {resolvedRequests.slice(0, 20).map((r) => (
              <li key={r.id} className="network-list-item">
                <div>
                  <span className="mono-sm">{r.requesterName || abbreviateAddress(r.requesterAddress)}</span>
                  <span className={`request-status request-status-${r.status}`}> {r.status}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function RequestItem({ request, onAction }: {
  request: LocationRequest;
  onAction: (action: string, extra?: Record<string, unknown>) => void;
}) {
  return (
    <li className="network-list-item network-request-item">
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "0.8rem", fontWeight: 500 }}>
          {request.requesterName || abbreviateAddress(request.requesterAddress)}
        </div>
        <div className="muted" style={{ fontSize: "0.65rem" }}>
          {request.requesterSsuId ? `From SSU: ${anonSsuName(request.requesterSsuId)}` : "Direct request"}
        </div>
      </div>
      <div className="network-request-actions">
        <button className="btn-primary btn-sm-network" onClick={() => onAction("resolve", { status: "approved" })}>
          Approve
        </button>
        <button className="btn-subtle btn-sm-network" onClick={() => onAction("resolve", { status: "denied" })}>
          Deny
        </button>
        <button
          className="btn-subtle btn-danger-text btn-sm-network"
          onClick={() => onAction("block", { address: request.requesterAddress, blockedSsuId: request.requesterSsuId })}
          title="Block this user and SSU from future requests"
        >
          Block
        </button>
      </div>
    </li>
  );
}
