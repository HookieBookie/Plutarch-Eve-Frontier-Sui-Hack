import { useState } from "react";
import { abbreviateAddress } from "@evefrontier/dapp-kit";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { useNetworkSettings } from "../hooks/useNetworkSettings";
import { useLocationRequests, type LocationRequest } from "../hooks/useLocationRequests";
import { useGoals } from "../context/GoalContext";
import { useVaultId } from "../hooks/useVaultId";
import { useDeploymentConfig, useTicker } from "../context/DeploymentContext";
import { useCharacter } from "../hooks/useCharacter";
import { anonSsuName } from "../utils/ssuNames";
import { VAULT_COIN_TYPE } from "../config";
import { verifyNetworkNode, useNetworkNodeFuel } from "../hooks/useNetworkNodeFuel";
import { useSsuInventory } from "../hooks/useSsuInventory";
import { FuelProgressBar } from "../components/FuelDisplay";

const DECIMALS = 1_000_000_000;

interface MemberBalance {
  address: string;
  name: string;
  balance: number;
}

export function SettingsPage() {
  const { settings, loading: settingsLoading, updateSettings } = useNetworkSettings();
  const { requests, loading: reqLoading, performAction } = useLocationRequests();
  const { ssuId: currentSsuId, tribeId } = useGoals();
  const account = useCurrentAccount();
  const { data: character } = useCharacter(account?.address);
  const { data: vaultId } = useVaultId(character?.tribeId);
  const { config } = useDeploymentConfig();
  const { signAndExecuteTransaction } = useDAppKit();
  const [whitelistInput, setWhitelistInput] = useState("");
  const ticker = useTicker();

  // ── Network Node linking state ──
  const [nnInput, setNnInput] = useState("");
  const [nnStatus, setNnStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [nnLoading, setNnLoading] = useState(false);
  const { data: ssuInventory } = useSsuInventory(currentSsuId || undefined);
  const { fuel: currentFuel } = useNetworkNodeFuel(settings?.networkNodeId);

  // ── Plutarch SSU Deletion state ──
  const [deleteInput, setDeleteInput] = useState("");
  const [deleteStatus, setDeleteStatus] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [confirmData, setConfirmData] = useState<{ ssuId: string; members: MemberBalance[] } | null>(null);

  const pendingRequests = requests.filter((r) => r.status === "pending");
  const resolvedRequests = requests.filter((r) => r.status !== "pending");

  const handleDeleteLookup = async () => {
    const target = deleteInput.trim();
    setDeleteStatus(null);
    setConfirmData(null);
    if (!target) return;
    if (target.toLowerCase() === currentSsuId.toLowerCase()) {
      setDeleteStatus({ type: "error", message: "Cannot delete the current SSU. This tool is for removing remote SSUs only." });
      return;
    }
    if (!account?.address) {
      setDeleteStatus({ type: "error", message: "Connect your wallet first." });
      return;
    }
    setDeleteLoading(true);
    try {
      const res = await fetch(
        `/api/ssu-delete-preview?ssuId=${encodeURIComponent(target)}&tribeId=${encodeURIComponent(tribeId)}&wallet=${encodeURIComponent(account.address)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setDeleteStatus({ type: "error", message: data.error || "Lookup failed" });
        return;
      }
      setConfirmData({ ssuId: target, members: data.members ?? [] });
    } catch {
      setDeleteStatus({ type: "error", message: "Network error — could not reach server." });
    } finally {
      setDeleteLoading(false);
    }
  };

  const handleDeleteConfirm = async () => {
    if (!confirmData || !account?.address) return;
    setDeleteLoading(true);
    setDeleteStatus(null);
    const settledWallets: string[] = [];
    try {
      // Step 1: Transfer earned credits on-chain for members with positive balances
      const membersToSettle = confirmData.members.filter((m) => m.balance > 0);
      if (membersToSettle.length > 0) {
        if (!vaultId || !config?.creditCoinType) {
          setDeleteStatus({ type: "error", message: "Vault not found — cannot transfer credits on-chain. Try again after vault loads." });
          setDeleteLoading(false);
          return;
        }
        setDeleteStatus({ type: "info", message: `Transferring credits to ${membersToSettle.length} member(s) on-chain. Please sign the transaction…` });

        const tx = new Transaction();
        for (const m of membersToSettle) {
          const amountBase = BigInt(Math.floor(m.balance * DECIMALS));
          tx.moveCall({
            target: `${config.packageId}::vault::pay_reward`,
            typeArguments: [VAULT_COIN_TYPE, config.creditCoinType],
            arguments: [
              tx.object(vaultId),
              tx.pure.u64(amountBase),
              tx.pure.address(m.address),
            ],
          });
        }

        const txResult = await signAndExecuteTransaction({ transaction: tx });
        if (txResult.$kind !== "Transaction") {
          setDeleteStatus({ type: "error", message: "On-chain credit transfer failed. SSU was NOT deleted." });
          setDeleteLoading(false);
          return;
        }
        for (const m of membersToSettle) settledWallets.push(m.address);
      }

      // Step 2: Delete the SSU (server-side cascade + zero settled balances)
      const res = await fetch("/api/ssu-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ssuId: confirmData.ssuId,
          tribeId,
          wallet: account.address,
          settledWallets,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDeleteStatus({ type: "error", message: data.error || "Deletion failed" });
      } else {
        const creditMsg = settledWallets.length > 0
          ? ` ${settledWallets.length} member(s) had their credits transferred on-chain.`
          : "";
        setDeleteStatus({ type: "success", message: `SSU ${anonSsuName(confirmData.ssuId)} has been deleted successfully.${creditMsg}` });
        setDeleteInput("");
      }
    } catch {
      setDeleteStatus({ type: "error", message: "Network error — could not reach server." });
    } finally {
      setDeleteLoading(false);
      setConfirmData(null);
    }
  };

  if (settingsLoading) {
    return <div className="page-single"><section className="panel"><p className="muted">Loading settings…</p></section></div>;
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

      {/* ── Network Node Link ── */}
      <section className="panel">
        <h3>Network Node</h3>
        <p className="muted" style={{ fontSize: "0.72rem", marginBottom: "0.75rem" }}>
          Link a Network Node to this SSU to display fuel status on the home page and network map.
          Fuel information is shared with users who have been granted location access.
        </p>

        {settings.networkNodeId ? (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
              <span className="stat-label" style={{ fontSize: "0.7rem" }}>Linked Node</span>
              <span style={{ fontSize: "0.65rem", wordBreak: "break-all", opacity: 0.7, flex: 1 }}>{settings.networkNodeId}</span>
            </div>
            {currentFuel && (
              <div style={{ marginBottom: "0.6rem" }}>
                <FuelProgressBar percent={currentFuel.percent} msRemaining={currentFuel.msRemaining} />
                <div style={{ fontSize: "0.7rem", marginTop: "0.25rem", opacity: 0.8 }}>
                  {currentFuel.isBurning
                    ? `${currentFuel.percent.toFixed(1)}% — ${currentFuel.timeRemainingLabel} remaining`
                    : currentFuel.quantity > 0 ? "Offline (not burning)" : "Empty"}
                </div>
              </div>
            )}
            <button
              className="btn-subtle btn-danger-text"
              style={{ fontSize: "0.75rem" }}
              onClick={() => {
                updateSettings.mutate({ visibility: settings.visibility, locationPolicy: settings.locationPolicy, networkNodeId: "" });
                setNnStatus(null);
              }}
            >
              Unlink Network Node
            </button>
          </div>
        ) : (
          <div>
            <div className="network-add-row">
              <input
                type="text"
                className="setup-input"
                placeholder="Network Node Assembly ID (0x…)"
                value={nnInput}
                onChange={(e) => { setNnInput(e.target.value); setNnStatus(null); }}
                style={{ flex: 1 }}
              />
              <button
                className="btn-primary"
                disabled={!nnInput.trim() || nnLoading}
                onClick={async () => {
                  const id = nnInput.trim();
                  if (!id.startsWith("0x")) {
                    setNnStatus({ type: "error", message: "ID must start with 0x" });
                    return;
                  }
                  setNnLoading(true);
                  setNnStatus({ type: "info", message: "Verifying on-chain…" });
                  try {
                    const result = await verifyNetworkNode(id);
                    // Verify owner matches SSU owner
                    const ssuOwner = ssuInventory?.ownerId?.toLowerCase();
                    const nnOwner = result.ownerAddress?.toLowerCase();
                    if (ssuOwner && nnOwner && ssuOwner !== nnOwner) {
                      setNnStatus({ type: "error", message: `Owner mismatch — this Network Node belongs to a different wallet (${abbreviateAddress(result.ownerAddress!)}).` });
                      return;
                    }
                    // Save it
                    updateSettings.mutate(
                      { visibility: settings.visibility, locationPolicy: settings.locationPolicy, networkNodeId: id },
                      {
                        onSuccess: () => {
                          setNnStatus({ type: "success", message: `Linked! ${result.name || "Network Node"} — ${result.fuel.percent.toFixed(1)}% fuel (${result.fuel.timeRemainingLabel})` });
                          setNnInput("");
                        },
                      },
                    );
                  } catch (err) {
                    setNnStatus({ type: "error", message: err instanceof Error ? err.message : "Verification failed" });
                  } finally {
                    setNnLoading(false);
                  }
                }}
                style={{ fontSize: "0.78rem", padding: "0.35rem 0.75rem", whiteSpace: "nowrap" }}
              >
                {nnLoading ? "Verifying…" : "Link"}
              </button>
            </div>
            {nnStatus && (
              <p style={{
                marginTop: "0.5rem", fontSize: "0.72rem",
                color: nnStatus.type === "success" ? "var(--color-success, #38a169)"
                  : nnStatus.type === "info" ? "var(--color-accent, #FF6600)"
                  : "var(--color-danger, #e53e3e)",
              }}>{nnStatus.message}</p>
            )}
          </div>
        )}
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

      {/* ── Plutarch SSU Deletion ── */}
      <section className="panel">
        <h3>Plutarch SSU Deletion</h3>
        <p className="muted" style={{ fontSize: "0.72rem", marginBottom: "0.75rem" }}>
          Remove an SSU and all its associated data from the database. This is intended for SSUs that
          have been deleted in-game. You must be the SSU owner. The current SSU cannot be deleted.
        </p>
        <div className="network-add-row">
          <input
            type="text"
            className="setup-input"
            placeholder="Smart Assembly ID (0x…)"
            value={deleteInput}
            onChange={(e) => { setDeleteInput(e.target.value); setDeleteStatus(null); setConfirmData(null); }}
            style={{ flex: 1 }}
          />
          <button
            className="btn-primary"
            disabled={!deleteInput.trim() || deleteLoading}
            onClick={handleDeleteLookup}
            style={{ fontSize: "0.78rem", padding: "0.35rem 0.75rem" }}
          >
            {deleteLoading && !confirmData ? "Looking up…" : "Delete"}
          </button>
        </div>

        {/* Confirmation dialog */}
        {confirmData && (
          <div className="ssu-delete-confirm" style={{ marginTop: "0.75rem", padding: "0.75rem", border: "1px solid var(--color-danger, #e53e3e)", borderRadius: "4px", background: "rgba(229,62,62,0.06)" }}>
            <p style={{ fontSize: "0.78rem", marginBottom: "0.5rem", fontWeight: 600 }}>
              Are you sure you want to delete SSU {anonSsuName(confirmData.ssuId)}?
            </p>
            <p className="muted" style={{ fontSize: "0.68rem", marginBottom: "0.75rem" }}>
              This will permanently remove the SSU and all associated data (goals, missions, members, market orders, network links, deliveries, etc.). This action cannot be undone.
            </p>
            {confirmData.members.length > 0 && (
              <div style={{ marginBottom: "0.75rem" }}>
                <p style={{ fontSize: "0.72rem", fontWeight: 500, marginBottom: "0.35rem" }}>
                  {confirmData.members.length} member(s) with earned credits will be settled on-chain:
                </p>
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                  {confirmData.members.map((m) => (
                    <li key={m.address} style={{ fontSize: "0.7rem", padding: "0.15rem 0", display: "flex", justifyContent: "space-between" }}>
                      <span className="mono-sm">{m.name || abbreviateAddress(m.address)}</span>
                      <span>{m.balance.toLocaleString()} {ticker}</span>
                    </li>
                  ))}
                </ul>
                <p className="muted" style={{ fontSize: "0.65rem", marginTop: "0.35rem" }}>
                  You will sign a transaction to transfer these credits on-chain. Gas fees are paid by your wallet.
                </p>
              </div>
            )}
            <div style={{ display: "flex", gap: "0.5rem" }}>
              <button
                className="btn-primary"
                style={{ background: "var(--color-danger, #e53e3e)", fontSize: "0.78rem", padding: "0.35rem 0.75rem" }}
                disabled={deleteLoading}
                onClick={handleDeleteConfirm}
              >
                {deleteLoading ? "Deleting…" : "Confirm Delete"}
              </button>
              <button
                className="btn-subtle"
                onClick={() => setConfirmData(null)}
                style={{ fontSize: "0.78rem", padding: "0.35rem 0.75rem" }}
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Status messages */}
        {deleteStatus && (
          <p style={{
            marginTop: "0.5rem",
            fontSize: "0.75rem",
            color: deleteStatus.type === "success" ? "var(--color-success, #38a169)"
              : deleteStatus.type === "info" ? "var(--color-accent, #FF6600)"
              : "var(--color-danger, #e53e3e)",
          }}>
            {deleteStatus.message}
          </p>
        )}
      </section>
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
