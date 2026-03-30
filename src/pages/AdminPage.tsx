import { useState } from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { useAdminAuth } from "../hooks/useAdminAuth";
import { useTokenBalances } from "../hooks/useTokenBalances";
import { useCharacter } from "../hooks/useCharacter";
import { useGoals } from "../context/GoalContext";
import { useAuthorizeExtension } from "../hooks/useEphemeralTransfer";
import { resolveSsuObjectId } from "../hooks/useSsuInventory";
import {
  ADMIN_ADDRESS,
  VAULT_COIN_TYPE,
  SUI_RPC_URL,
  SUI_NETWORK,
  EXTENSION_PACKAGE_ID,
  FEE_BPS,
} from "../config";
import { friendlyTxError } from "../utils/friendlyTxError";

const rpc = new SuiJsonRpcClient({ url: SUI_RPC_URL, network: SUI_NETWORK });
const DECIMALS = 1_000_000_000;

function floorTo4(n: number): string {
  return (Math.floor(n * 10000) / 10000).toFixed(4);
}

interface AdminPageProps {
  onNavigateHome: () => void;
}

export function AdminPage({ onNavigateHome }: AdminPageProps) {
  const account = useCurrentAccount();
  const {
    isAdmin,
    authenticated,
    pending: authPending,
    error: authError,
    authenticate,
    logout,
  } = useAdminAuth();

  const { data: balances } = useTokenBalances(account?.address);
  const { signAndExecuteTransaction } = useDAppKit();
  const { data: character } = useCharacter(account?.address);
  const { ssuId } = useGoals();
  const { authorize: authorizeExtension, pending: extPending } = useAuthorizeExtension(ssuId || undefined);
  const [extStatus, setExtStatus] = useState<string | null>(null);

  const [transferAmount, setTransferAmount] = useState("");
  const [transferRecipient, setTransferRecipient] = useState("");
  const [transferPending, setTransferPending] = useState(false);
  const [transferError, setTransferError] = useState<string | null>(null);
  const [transferDigest, setTransferDigest] = useState<string | null>(null);

  function goHome() {
    logout();
    onNavigateHome();
  }

  async function handleAuthorizeExtension() {
    if (!account || !ssuId || !character?.objectId) return;
    setExtStatus("Looking up SSU\u2026");
    try {
      const ssuObjectId = await resolveSsuObjectId(ssuId);

      setExtStatus("Fetching SSU data\u2026");
      const extRpc = new SuiJsonRpcClient({ url: SUI_RPC_URL, network: SUI_NETWORK });
      const ssuObj = await extRpc.getObject({ id: ssuObjectId, options: { showContent: true } });
      const fields = (ssuObj.data?.content as { fields?: Record<string, unknown> })?.fields;
      const capId = fields?.owner_cap_id as string | undefined;

      if (!capId) {
        setExtStatus("Could not read owner_cap_id from SSU object.");
        return;
      }

      const extValue = fields?.extension;
      if (extValue != null) {
        const extStr = typeof extValue === "string" ? extValue : JSON.stringify(extValue);
        if (extStr.includes(EXTENSION_PACKAGE_ID.replace(/^0x/, ""))) {
          setExtStatus("Extension is already authorized \u2713");
          return;
        }
        setExtStatus("Re-authorizing extension for updated package\u2026");
      }

      setExtStatus(`Signing authorization (cap: ${capId.slice(0, 10)}\u2026)\u2026`);
      const ok = await authorizeExtension(capId, character.objectId);
      setExtStatus(ok ? "Extension authorized \u2713" : "Authorization failed \u2014 check console for details");
    } catch (e: unknown) {
      setExtStatus(`Error: ${(e as Error).message}`);
    }
  }

  // ── Not connected ──
  if (!account) {
    return (
      <div className="page-grid">
        <section className="panel admin-gate">
          <h3>Access Denied</h3>
          <p className="muted">Connect your wallet to continue.</p>
          <button className="btn-primary" onClick={goHome} style={{ marginTop: "0.75rem" }}>
            Return Home
          </button>
        </section>
      </div>
    );
  }

  // ── Not admin ──
  if (!isAdmin) {
    return (
      <div className="page-grid">
        <section className="panel admin-gate">
          <h3>Access Denied</h3>
          <p className="muted">This page is restricted to the Plutarch administrator.</p>
          <button className="btn-primary" onClick={goHome} style={{ marginTop: "0.75rem" }}>
            Return Home
          </button>
        </section>
      </div>
    );
  }

  // ── Not authenticated (address matches but no signature proof) ──
  if (!authenticated) {
    return (
      <div className="page-grid">
        <section className="panel admin-gate">
          <h3>Admin Authentication</h3>
          <p className="muted">
            Sign a verification message with your wallet to prove ownership of
            the Plutarch admin address.
          </p>
          {authError && <p className="error">{authError}</p>}
          <button
            className="btn-primary"
            onClick={authenticate}
            disabled={authPending}
            style={{ marginTop: "0.75rem" }}
          >
            {authPending ? "Waiting for wallet…" : "Authenticate"}
          </button>
          <button
            className="btn-subtle"
            onClick={goHome}
            style={{ marginTop: "0.5rem" }}
          >
            Cancel
          </button>
        </section>
      </div>
    );
  }

  // ── Authenticated admin dashboard ──
  const adminEve = balances?.eve ?? 0;
  const adminSui = balances?.sui ?? 0;

  async function handleTransfer() {
    if (!account || !transferRecipient || !transferAmount) return;

    if (!/^0x[a-fA-F0-9]{64}$/.test(transferRecipient)) {
      setTransferError("Invalid recipient address. Must be a 66-character hex address (0x…).");
      return;
    }

    const amount = parseFloat(transferAmount);
    if (isNaN(amount) || amount <= 0) {
      setTransferError("Amount must be a positive number.");
      return;
    }

    setTransferPending(true);
    setTransferError(null);
    setTransferDigest(null);

    try {
      const amountBase = BigInt(Math.floor(amount * DECIMALS));
      const tx = new Transaction();
      const isSui = VAULT_COIN_TYPE === "0x2::sui::SUI";
      let coin;

      if (isSui) {
        [coin] = tx.splitCoins(tx.gas, [tx.pure.u64(amountBase)]);
      } else {
        const coins = await rpc.getCoins({
          owner: account.address,
          coinType: VAULT_COIN_TYPE,
        });
        if (!coins.data.length) {
          setTransferError("No EVE coins found in wallet.");
          setTransferPending(false);
          return;
        }
        const primaryCoinId = coins.data[0].coinObjectId;
        if (coins.data.length > 1) {
          tx.mergeCoins(
            tx.object(primaryCoinId),
            coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
          );
        }
        [coin] = tx.splitCoins(tx.object(primaryCoinId), [tx.pure.u64(amountBase)]);
      }

      tx.transferObjects([coin], transferRecipient);

      const result = await signAndExecuteTransaction({ transaction: tx });

      if (result.$kind === "Transaction") {
        setTransferDigest(result.Transaction.digest);
        setTransferAmount("");
        setTransferRecipient("");
      } else {
        setTransferError("Transaction failed on-chain.");
      }
    } catch (e: unknown) {
      setTransferError(friendlyTxError(e));
    } finally {
      setTransferPending(false);
    }
  }

  return (
    <div className="page-grid admin-page">
      {/* Protocol Wallet */}
      <section className="panel">
        <h3>Protocol Wallet</h3>
        <div className="stat-grid">
          <div className="stat" style={{ gridColumn: "1 / -1" }}>
            <span className="stat-label">Fee Recipient Address</span>
            <span
              className="stat-value"
              style={{ fontSize: "0.6rem", wordBreak: "break-all" }}
            >
              {ADMIN_ADDRESS}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">EVE Balance</span>
            <span className="stat-value">{floorTo4(adminEve)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">SUI Balance</span>
            <span className="stat-value">{floorTo4(adminSui)}</span>
          </div>
        </div>
      </section>

      {/* Fee Revenue */}
      <section className="panel">
        <h3>Fee Revenue</h3>
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">Protocol Fee</span>
            <span className="stat-value">{FEE_BPS / 100}% per txn</span>
          </div>
          <div className="stat">
            <span className="stat-label">Accumulated EVE (wallet)</span>
            <span className="stat-value stat-earned">{floorTo4(adminEve)}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Revenue Sources</span>
            <span className="stat-value" style={{ fontSize: "0.7rem" }}>Deposits + Redeems</span>
          </div>
        </div>
        <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.65rem" }}>
          1% protocol fee collected on every deposit and redemption, sent directly to the admin wallet above.
        </p>
      </section>

      {/* Transfer EVE */}
      <section className="panel">
        <h3>Transfer EVE</h3>
        <p className="muted" style={{ fontSize: "0.7rem", marginBottom: "0.5rem" }}>
          Send EVE tokens from this wallet to another address.
        </p>
        <div className="admin-action-col">
          <input
            type="text"
            placeholder="Recipient address (0x…)"
            value={transferRecipient}
            onChange={(e) => setTransferRecipient(e.target.value)}
            disabled={transferPending}
            style={{ fontFamily: "monospace", fontSize: "0.7rem" }}
          />
          <div className="admin-action-row">
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="EVE amount"
              value={transferAmount}
              onChange={(e) => setTransferAmount(e.target.value)}
              disabled={transferPending}
            />
            <button
              className="btn-primary"
              onClick={handleTransfer}
              disabled={transferPending || !transferAmount || !transferRecipient}
            >
              {transferPending ? "Processing…" : "Transfer"}
            </button>
          </div>
        </div>
        {transferError && <p className="error">{transferError}</p>}
        {transferDigest && (
          <p className="success">✓ Transferred — <a href={`https://suiscan.xyz/${SUI_NETWORK}/tx/${transferDigest}`} target="_blank" rel="noopener noreferrer">tx: {transferDigest.slice(0, 16)}…</a></p>
        )}
      </section>

      {/* Extension Authorization */}
      <section className="panel" style={{ borderLeft: "3px solid #f0a030" }}>
        <h3>On-chain Settlement</h3>
        <p className="muted" style={{ fontSize: "0.7rem", marginBottom: "0.5rem" }}>
          On-chain item transfers require authorizing the extension on this SSU.
          The OwnerCap may be held by the game server — if authorization fails, operations still work off-chain.
        </p>
        {extStatus && (
          <div style={{ fontSize: "0.72rem", marginBottom: "0.5rem", color: extStatus.includes("\u2713") ? "#4caf50" : extStatus.includes("Error") || extStatus.includes("failed") ? "#ef5350" : "#f0a030" }}>
            {extStatus}
          </div>
        )}
        <button
          className="btn-primary"
          disabled={extPending || !ssuId}
          onClick={handleAuthorizeExtension}
          style={{ fontSize: "0.78rem", padding: "0.35rem 0.8rem" }}
        >
          {extPending ? "Authorizing\u2026" : "Authorize Extension"}
        </button>
        {!ssuId && <p className="muted" style={{ fontSize: "0.65rem", marginTop: "0.4rem" }}>No SSU selected — return home to select one.</p>}
      </section>
    </div>
  );
}
