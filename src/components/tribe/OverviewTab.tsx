import { useState, useMemo } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { useQueryClient } from "@tanstack/react-query";
import { useVaultData } from "../../hooks/useVaultData";
import { useCharacter } from "../../hooks/useCharacter";
import { useTokenBalances } from "../../hooks/useTokenBalances";
import { useFundBudget } from "../../hooks/useVaultTransactions";
import { useVaultId } from "../../hooks/useVaultId";
import { useTribeTax } from "../../hooks/useTribeTax";
import { useLedger } from "../../hooks/useLedger";
import { useGoals } from "../../context/GoalContext";
import { useNetworkMap } from "../../hooks/useNetworkMap";
import { useTerritoryData } from "../../hooks/useTerritoryData";
import { TRIBE_ID, CREDIT_MULTIPLIER, FEE_BPS, SUI_NETWORK } from "../../config";
import { useTicker } from "../../context/DeploymentContext";
import { sanitiseLabel, ssuDisplayName } from "../../utils/ssuNames";
import { Select } from "../Select";

export function OverviewTab({ isOwner }: { isOwner: boolean }) {
  const account = useCurrentAccount();
  const { data: character } = useCharacter(account?.address);
  const { data: balances } = useTokenBalances(account?.address);
  const { data: vaultId } = useVaultId(character?.tribeId);
  const { data: vault, isLoading: vaultLoading, error: vaultError } = useVaultData(vaultId);
  const { taxPct, setTaxBps, saving: taxSaving } = useTribeTax(String(character?.tribeId ?? TRIBE_ID));
  const { goals, budgetPool, depositedBudget, onChainBudget, ssuId, tribeId } = useGoals();
  const { fundBudget, pending: fundPending, error: fundError, digest: fundDigest } = useFundBudget(vaultId);
  const { logEvent } = useLedger(ssuId, tribeId);
  const ticker = useTicker();
  const queryClient = useQueryClient();

  const [eveAmt, setEveAmt] = useState("");
  const [creditAmt, setCreditAmt] = useState("");
  const [budgetError, setBudgetError] = useState<string | null>(null);
  const [taxInput, setTaxInput] = useState("");

  // Transfer state
  const [transferTarget, setTransferTarget] = useState("");
  const [transferAmt, setTransferAmt] = useState("");
  const [transferConfirm, setTransferConfirm] = useState(false);
  const [transferPending, setTransferPending] = useState(false);
  const [transferResult, setTransferResult] = useState<{ ok?: boolean; error?: string } | null>(null);

  // Network map for BFS reachable SSUs
  const { nodes, links } = useNetworkMap(tribeId);
  const walletAddr = account?.address ?? "";
  const { ssus } = useTerritoryData(tribeId, walletAddr);

  const ownedSsuIds = useMemo(() => new Set(
    ssus.filter((s) => s.activatedBy.toLowerCase() === walletAddr.toLowerCase()).map((s) => s.ssuId),
  ), [ssus, walletAddr]);

  // BFS: find SSUs reachable from current SSU via data links (only owned SSUs)
  const reachableSsus = useMemo(() => {
    const currentNode = nodes.find((n) => n.ssuId === ssuId);
    if (!currentNode) return [];
    const visited = new Set<string>([currentNode.id]);
    const queue = [currentNode.id];
    while (queue.length > 0) {
      const nid = queue.shift()!;
      for (const link of links) {
        if (link.linkType !== "data") continue;
        const neighbor = link.fromNodeId === nid ? link.toNodeId : link.toNodeId === nid ? link.fromNodeId : null;
        if (!neighbor || visited.has(neighbor)) continue;
        const neighborNode = nodes.find((n) => n.id === neighbor);
        if (neighborNode && ownedSsuIds.has(neighborNode.ssuId)) {
          visited.add(neighbor);
          queue.push(neighbor);
        }
      }
    }
    // Return nodes that are reachable but not the current SSU
    return nodes.filter((n) => visited.has(n.id) && n.ssuId !== ssuId);
  }, [nodes, links, ssuId, ownedSsuIds]);

  const activeGoals = goals.filter((g) => g.status !== "cancelled");
  const allocatedBudget = activeGoals.reduce((s, g) => s + g.budget, 0);

  const feeRate = 1 - FEE_BPS / 10000;
  function eveToCredits(eve: number) { return Math.floor(eve * feeRate * CREDIT_MULTIPLIER); }
  function creditsToEve(credits: number) { return Math.ceil((credits / CREDIT_MULTIPLIER / feeRate) * 10000) / 10000; }
  function handleEveChange(v: string) { setEveAmt(v); setCreditAmt(Number(v) > 0 ? String(eveToCredits(Number(v))) : ""); }
  function handleCreditChange(v: string) { setCreditAmt(v); setEveAmt(Number(v) > 0 ? String(creditsToEve(Number(v))) : ""); }

  async function handleDepositToBudget() {
    const amt = Number(eveAmt);
    if (!amt || amt <= 0) return;
    if (balances && amt > balances.eve) {
      setBudgetError(`Insufficient EVE — you have ${balances.eve.toFixed(4)} EVE`);
      return;
    }
    setBudgetError(null);
    const creditsMinted = eveToCredits(amt);
    const success = await fundBudget(amt);
    if (success) {
      // Record deposit for this SSU's per-SSU budget tracking
      try {
        await fetch("/api/record-deposit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ssuId, tribeId, creditAmount: creditsMinted }),
        });
      } catch { /* best-effort — on-chain TX already succeeded */ }
      logEvent({ eventType: "budget_fund", amount: creditsMinted });
      setEveAmt("");
      setCreditAmt("");
      queryClient.invalidateQueries({ queryKey: ["plutarch-vault"] });
    }
  }

  return (
    <>
      {account && !character && (
        <p className="muted">No EVE Frontier character found for this wallet.</p>
      )}
      {!account && (
        <p className="muted">Connect your in-game wallet to see character info.</p>
      )}
      {vaultLoading ? (
        <p className="muted">Connecting to chain...</p>
      ) : vaultError ? (
        <div>
          <p className="muted">Chain offline — vault stats unavailable</p>
          <p className="error" style={{ fontSize: "0.7rem" }}>{(vaultError as Error).message}</p>
        </div>
      ) : vault ? (
        <div className="stat-grid">
          <div className="stat">
            <span className="stat-label">EVE Backing</span>
            <span className="stat-value">{(vault.eveBacking / 1e9).toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">{ticker} Supply</span>
            <span className="stat-value">{(vault.creditSupply / 1e9).toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Exchange Rate</span>
            <span className="stat-value">1:{CREDIT_MULTIPLIER}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Tribe Tax</span>
            <span className="stat-value">
              {isOwner ? (
                <span className="tribe-tax-inline">
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="0.1"
                    className="tax-input"
                    placeholder={String(taxPct)}
                    value={taxInput}
                    onChange={(e) => setTaxInput(e.target.value)}
                  />
                  <span>%</span>
                  {taxInput !== "" && Number(taxInput) !== taxPct && (
                    <button
                      className="btn-tax-save"
                      disabled={taxSaving}
                      onClick={() => {
                        const bps = Math.round(Number(taxInput) * 100);
                        if (bps >= 0 && bps <= 5000) {
                          setTaxBps(bps).then(() => setTaxInput(""));
                        }
                      }}
                    >
                      {taxSaving ? "…" : "✓"}
                    </button>
                  )}
                </span>
              ) : (
                <span>{taxPct}%</span>
              )}
            </span>
          </div>
          <div className="stat">
            <span className="stat-label">On-chain Budget</span>
            <span className="stat-value">{(vault.creditBudget / 1e9).toLocaleString()}</span>
          </div>
        </div>
      ) : (
        <p className="muted">Vault not found — no vault registered for your tribe</p>
      )}

      {/* SSU Budget */}
      <div className="budget-pool-section">
        <div className="budget-pool-stats">
          <div className="stat">
            <span className="stat-label">Available Budget</span>
            <span className="stat-value">{budgetPool.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Allocated</span>
            <span className="stat-value">{allocatedBudget.toLocaleString()}</span>
          </div>
          <div className="stat">
            <span className="stat-label">SSU Deposited</span>
            <span className="stat-value">{depositedBudget.toLocaleString()}</span>
          </div>
        </div>
        <p className="muted" style={{ fontSize: "0.68rem", margin: "0.35rem 0 0.5rem" }}>
          Budget is tracked per-SSU. Only {ticker} deposited from this SSU can be allocated to goals.
          {onChainBudget > 0 && ` Tribe-wide on-chain budget: ${onChainBudget.toLocaleString()} ${ticker}.`}
        </p>
        {isOwner && (<>
        <div className="budget-deposit-row">
          <h4>Fund Budget</h4>
          <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
            Deposit EVE to mint {ticker} for this SSU's budget (1 EVE = {CREDIT_MULTIPLIER} {ticker}, {FEE_BPS / 100}% protocol fee deducted in EVE).
          </p>
          {balances && (
            <div className="balance-info">
              <span>SUI: {balances.sui.toFixed(4)}</span>
              <span>EVE: {balances.eve.toFixed(4)}</span>
            </div>
          )}
          <div className="fund-row">
            <div className="fund-field">
              <label className="fund-label">EVE to spend</label>
              <input
                type="number"
                min="0"
                step="0.01"
                max={balances ? balances.eve : undefined}
                placeholder="0"
                value={eveAmt}
                onChange={(e) => { handleEveChange(e.target.value); setBudgetError(null); }}
              />
            </div>
            <span className="fund-arrow">→</span>
            <div className="fund-field">
              <label className="fund-label">{ticker} received</label>
              <input
                type="number"
                min="0"
                step="1"
                placeholder="0"
                value={creditAmt}
                onChange={(e) => { handleCreditChange(e.target.value); setBudgetError(null); }}
              />
            </div>
            <button
              className="btn-primary"
              disabled={fundPending || !eveAmt || Number(eveAmt) <= 0 || (balances != null && Number(eveAmt) > balances.eve)}
              onClick={handleDepositToBudget}
            >
              {fundPending ? "..." : "Fund"}
            </button>
          </div>
          {budgetError && <p className="error">{budgetError}</p>}
          {fundError && <p className="error">{fundError}</p>}
          {fundDigest && <p className="success"><a href={`https://suiscan.xyz/${SUI_NETWORK}/tx/${fundDigest}`} target="_blank" rel="noopener noreferrer">TX: {fundDigest.slice(0, 16)}...</a></p>}
        </div>

        {/* ── Transfer Budget ── */}
        {reachableSsus.length > 0 && (
          <div className="budget-deposit-row" style={{ marginTop: "1rem" }}>
            <h4>Transfer Budget</h4>
            <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
              Move unallocated {ticker} to another SSU in your data-link chain.
            </p>

            <div className="fund-row" style={{ flexWrap: "wrap" }}>
              <div className="fund-field" style={{ minWidth: 160 }}>
                <label className="fund-label">Target SSU</label>
                <Select
                  value={transferTarget}
                  onChange={(v) => { setTransferTarget(v); setTransferConfirm(false); setTransferResult(null); }}
                  options={[
                    { value: "", label: "Select SSU…" },
                    ...reachableSsus.map((n) => {
                      const terrSsu = ssus.find((s) => s.ssuId === n.ssuId);
                      return {
                        value: n.ssuId,
                        label: terrSsu ? ssuDisplayName(terrSsu) : sanitiseLabel(n.label, n.ssuId),
                      };
                    }),
                  ]}
                />
              </div>

              <div className="fund-field">
                <label className="fund-label">Amount ({ticker})</label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  max={budgetPool}
                  placeholder="0"
                  value={transferAmt}
                  onChange={(e) => { setTransferAmt(e.target.value); setTransferConfirm(false); setTransferResult(null); }}
                />
              </div>

              {!transferConfirm ? (
                <button
                  className="btn-primary"
                  disabled={!transferTarget || !transferAmt || Number(transferAmt) <= 0 || Number(transferAmt) > budgetPool}
                  onClick={() => setTransferConfirm(true)}
                >
                  Transfer
                </button>
              ) : (
                <button
                  className="btn-primary"
                  style={{ background: "var(--color-warning, #c90)" }}
                  disabled={transferPending}
                  onClick={async () => {
                    setTransferPending(true);
                    setTransferResult(null);
                    try {
                      const res = await fetch("/api/transfer-budget", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          fromSsuId: ssuId,
                          toSsuId: transferTarget,
                          tribeId,
                          amount: Number(transferAmt),
                        }),
                      });
                      const data = await res.json();
                      if (data.ok) {
                        setTransferResult({ ok: true });
                        setTransferAmt("");
                        setTransferConfirm(false);
                      } else {
                        setTransferResult({ error: data.error ?? "Transfer failed" });
                      }
                    } catch {
                      setTransferResult({ error: "Network error" });
                    } finally {
                      setTransferPending(false);
                    }
                  }}
                >
                  {transferPending ? "..." : `Confirm ${Number(transferAmt).toLocaleString()} ${ticker}`}
                </button>
              )}
            </div>

            {transferConfirm && !transferPending && (
              <p className="muted" style={{ fontSize: "0.7rem", marginTop: "0.25rem" }}>
                This will move {Number(transferAmt).toLocaleString()} {ticker} to{" "}
                {(() => { const ts = ssus.find((s) => s.ssuId === transferTarget); return ts ? ssuDisplayName(ts) : sanitiseLabel(reachableSsus.find((n) => n.ssuId === transferTarget)?.label ?? "", transferTarget); })()}.
                Click <strong>Confirm</strong> to proceed.
              </p>
            )}

            {transferResult?.ok && <p className="success">Budget transferred successfully.</p>}
            {transferResult?.error && <p className="error">{transferResult.error}</p>}
          </div>
        )}
        </>)}
      </div>
    </>
  );
}
