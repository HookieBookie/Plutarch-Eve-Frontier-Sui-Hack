import { useState, useMemo } from "react";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { useVaultData, useWalletCredits } from "../hooks/useVaultData";
import { useTokenBalances } from "../hooks/useTokenBalances";
import { useCharacter, fetchCharacter } from "../hooks/useCharacter";
import { useDeposit, useRedeem } from "../hooks/useVaultTransactions";
import { useVaultId } from "../hooks/useVaultId";
import { useOffChainBalance, useOffChainBalanceMutations } from "../hooks/useOffChainBalance";
import { useWithdrawReward } from "../hooks/useWithdrawReward";
import { useConvertEarnedToEve } from "../hooks/useConvertEarnedToEve";
import { TRIBE_ID, CREDIT_MULTIPLIER, FEE_BPS, SUI_NETWORK, SUI_RPC_URL } from "../config";
import { useTicker, useDeploymentConfig } from "../context/DeploymentContext";
import { Select } from "../components/Select";
import { useAllTribes, type TribeInfo } from "../hooks/useAllTribes";
import { useCrossSwap } from "../hooks/useCrossSwap";
import { TribeMarketBoard } from "../components/TribeMarketBoard";
import { useMyTribeCoinOrders, useTribeCoinOrderMutations } from "../hooks/useTribeCoinOrders";
import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
// price snapshot recording available via usePriceHistory hook

const rpc = new SuiJsonRpcClient({ url: SUI_RPC_URL, network: SUI_NETWORK });
const DECIMALS = 1e9;

type Asset = "earned" | "credits" | "eve";

/** Floor a number to 4 decimal places (never rounds up). */
function floorTo4(n: number): string {
  return (Math.floor(n * 10000) / 10000).toFixed(4);
}

/** Which "To" assets are valid for each "From" asset */
const VALID_PAIRS: Record<Asset, Asset[]> = {
  earned: ["credits", "eve"],
  credits: ["eve"],
  eve: ["credits"],
};

export function ExchangePage() {
  const account = useCurrentAccount();
  const { data: character } = useCharacter(account?.address);
  const tribeId = String(character?.tribeId ?? TRIBE_ID);
  const { data: vaultId } = useVaultId(character?.tribeId);
  const { data: vault, isLoading: vaultLoading } = useVaultData(vaultId);
  const { data: wallet } = useWalletCredits(account?.address, vault, vaultId);
  const { data: balances } = useTokenBalances(account?.address);
  const { deposit, pending: depositPending, error: depositError, digest: depositDigest } = useDeposit(vaultId);
  const { redeem, pending: redeemPending, error: redeemError, digest: redeemDigest } = useRedeem(vaultId);
  const { withdraw, pending: withdrawPending, error: withdrawError, digest: withdrawDigest } = useWithdrawReward(vaultId);
  const { convert, pending: convertPending, error: convertError, digest: convertDigest } = useConvertEarnedToEve(vaultId);
  const ticker = useTicker();

  const ASSET_LABELS: Record<Asset, string> = {
    earned: `Earned ${ticker}`,
    credits: `Wallet ${ticker}`,
    eve: "EVE",
  };

  const { data: earnedCredits } = useOffChainBalance(tribeId, account?.address);
  const { debit: debitBalance } = useOffChainBalanceMutations(tribeId, account?.address);

  const [fromAsset, setFromAsset] = useState<Asset>("eve");
  const [toAsset, setToAsset] = useState<Asset>("credits");
  const [amount, setAmount] = useState("");
  const [validation, setValidation] = useState<string | null>(null);

  const tribeName = character?.tribeName ?? `Tribe ${character?.tribeId ?? TRIBE_ID}`;

  const displayCredits = wallet ? Math.floor((wallet.credits / 1e9) * 10000) / 10000 : 0;
  const displayEarned = earnedCredits ?? 0;
  const feePct = FEE_BPS / 100;

  // On-chain vault state for dynamic redeem rate
  const eveBacking = vault?.eveBacking ?? 0; // in base units (1e9)
  const creditSupply = vault?.creditSupply ?? 0; // total credit supply in base units

  // Balance for the selected "from" asset
  const fromBalance = useMemo(() => {
    if (fromAsset === "earned") return displayEarned;
    if (fromAsset === "credits") return displayCredits;
    if (fromAsset === "eve") return balances?.eve ?? 0;
    return 0;
  }, [fromAsset, displayEarned, displayCredits, balances]);



  // Determine operation from the from→to pair
  const operation = useMemo(() => {
    if (fromAsset === "eve" && toAsset === "credits") return "buy" as const;
    if (fromAsset === "credits" && toAsset === "eve") return "sell" as const;
    if (fromAsset === "earned" && toAsset === "credits") return "withdraw" as const;
    if (fromAsset === "earned" && toAsset === "eve") return "convert" as const;
    return null;
  }, [fromAsset, toAsset]);

  // Compute output and fee breakdown — mirrors on-chain integer math
  const amt = Number(amount) || 0;
  const breakdown = useMemo(() => {
    if (amt <= 0 || !vault) return null;
    switch (operation) {
      case "buy": {
        // On-chain: fee = floor(total * FEE_BPS / 10000), backing = total - fee, credits = backing * MULTIPLIER
        const totalBase = BigInt(Math.floor(amt * 1e9));
        const feeBase = totalBase * BigInt(FEE_BPS) / 10000n;
        const backingBase = totalBase - feeBase;
        const creditsBase = backingBase * BigInt(CREDIT_MULTIPLIER);
        const fee = Number(feeBase) / 1e9;
        const backing = Number(backingBase) / 1e9;
        const creditsOut = Math.floor(Number(creditsBase) / 1e9);
        return {
          rows: [
            { label: "EVE deposited", value: `${floorTo4(amt)} EVE` },
            { label: `Protocol fee (${feePct}%)`, value: `−${floorTo4(fee)} EVE` },
            { label: "Net EVE (backing)", value: `${floorTo4(backing)} EVE` },
          ],
          total: `${creditsOut.toLocaleString()} ${ticker}`,
          output: creditsOut.toLocaleString(),
        };
      }
      case "sell": {
        // On-chain: eve_gross = floor(credits * eve_backing / total_supply), fee = floor(eve_gross * FEE_BPS / 10000)
        const creditsBase = BigInt(Math.floor(amt * 1e9));
        if (creditSupply <= 0) return null;
        const eveGrossBase = creditsBase * BigInt(eveBacking) / BigInt(creditSupply);
        const feeBase = eveGrossBase * BigInt(FEE_BPS) / 10000n;
        const eveNetBase = eveGrossBase - feeBase;
        const eveGross = Number(eveGrossBase) / 1e9;
        const fee = Number(feeBase) / 1e9;
        const eveNet = Number(eveNetBase) / 1e9;
        return {
          rows: [
            { label: "Gross EVE (at backing rate)", value: `${floorTo4(eveGross)} EVE` },
            { label: `Protocol fee (${feePct}%)`, value: `−${floorTo4(fee)} EVE` },
          ],
          total: `${floorTo4(eveNet)} EVE`,
          output: floorTo4(eveNet),
        };
      }
      case "withdraw":
        return {
          rows: [],
          total: `${Math.floor(amt).toLocaleString()} wallet ${ticker}`,
          output: Math.floor(amt).toLocaleString(),
        };
      case "convert": {
        // Two-step: pay_reward (credits from budget to wallet), then redeem at vault rate
        const creditsBase = BigInt(Math.floor(amt * 1e9));
        if (creditSupply <= 0) return null;
        const eveGrossBase = creditsBase * BigInt(eveBacking) / BigInt(creditSupply);
        const feeBase = eveGrossBase * BigInt(FEE_BPS) / 10000n;
        const eveNetBase = eveGrossBase - feeBase;
        const eveGross = Number(eveGrossBase) / 1e9;
        const fee = Number(feeBase) / 1e9;
        const eveNet = Number(eveNetBase) / 1e9;
        return {
          rows: [
            { label: "Gross EVE (at backing rate)", value: `${floorTo4(eveGross)} EVE` },
            { label: `Protocol fee (${feePct}%)`, value: `−${floorTo4(fee)} EVE` },
          ],
          total: `${floorTo4(eveNet)} EVE`,
          output: floorTo4(eveNet),
        };
      }
      default:
        return null;
    }
  }, [amt, operation, feePct, vault, eveBacking, creditSupply]);

  // Pending / error / digest from the active operation
  const activePending =
    operation === "buy" ? depositPending :
    operation === "sell" ? redeemPending :
    operation === "withdraw" ? withdrawPending :
    operation === "convert" ? convertPending : false;

  const activeError =
    operation === "buy" ? depositError :
    operation === "sell" ? redeemError :
    operation === "withdraw" ? withdrawError :
    operation === "convert" ? convertError : null;

  const activeDigest =
    operation === "buy" ? depositDigest :
    operation === "sell" ? redeemDigest :
    operation === "withdraw" ? withdrawDigest :
    operation === "convert" ? convertDigest : null;

  const OPERATION_LABELS: Record<string, string> = {
    buy: `Buy ${ticker}`,
    sell: `Sell ${ticker}`,
    withdraw: "Withdraw",
    convert: "Convert to EVE",
  };
  const OPERATION_HINTS: Record<string, string> = {
    buy: `Deposit EVE to receive ${ticker} on-chain.`,
    sell: `Redeem wallet ${ticker} for EVE (${feePct}% protocol fee).`,
    withdraw: `Move earned ${ticker} to your wallet as on-chain tokens (gas required).`,
    convert: `Cash out earned ${ticker} directly to EVE tokens (${feePct}% protocol fee). Requires two wallet signatures.`,
  };

  function handleFromChange(asset: Asset) {
    setFromAsset(asset);
    const valid = VALID_PAIRS[asset];
    if (!valid.includes(toAsset)) setToAsset(valid[0]);
    setAmount("");
    setValidation(null);
  }

  function handleSwap() {
    // Swap only works for credits↔eve
    if (fromAsset === "credits" && toAsset === "eve") {
      setFromAsset("eve");
      setToAsset("credits");
    } else if (fromAsset === "eve" && toAsset === "credits") {
      setFromAsset("credits");
      setToAsset("eve");
    }
    setAmount("");
    setValidation(null);
  }

  function handleAmountChange(v: string) {
    setAmount(v);
    setValidation(null);
    const val = Number(v);
    if (!val || val <= 0) return;
    if (val > fromBalance + 0.0001) {
      setValidation(`Insufficient ${ASSET_LABELS[fromAsset]} (have ${fromAsset === "eve" ? floorTo4(fromBalance) : Math.floor(fromBalance).toLocaleString()})`);
    }
  }

  async function handleExecute() {
    const val = Number(amount);
    if (!val || val <= 0 || !operation) return;
    if (val > fromBalance + 0.0001) {
      setValidation(`Insufficient ${ASSET_LABELS[fromAsset]}`);
      return;
    }
    let success = false;
    switch (operation) {
      case "buy":
        success = await deposit(val);
        break;
      case "sell":
        success = await redeem(val);
        break;
      case "withdraw":
        success = await withdraw(val);
        if (success) await debitBalance(val);
        break;
      case "convert":
        success = await convert(val);
        if (success) await debitBalance(val);
        break;
    }
    if (success) {
      setAmount("");
      setValidation(null);
    }
  }

  const canSwap = (fromAsset === "eve" && toAsset === "credits") || (fromAsset === "credits" && toAsset === "eve");

  // ─── Tab state ───
  type Tab = "exchange" | "cross-swap" | "market" | "send";
  const [activeTab, setActiveTab] = useState<Tab>("exchange");

  // ─── Cross-swap state ───
  const { data: allTribes, isLoading: tribesLoading } = useAllTribes();
  const { crossSwap, buyWithEve, pending: xPending, error: xError, digest: xDigest } = useCrossSwap();
  const [xSource, setXSource] = useState<string>("");
  const [xTarget, setXTarget] = useState<string>("");
  const [xMode, setXMode] = useState<"tribe-to-tribe" | "eve-to-tribe">("tribe-to-tribe");
  const [xAmount, setXAmount] = useState("");
  const [xValidation, setXValidation] = useState<string | null>(null);

  const sourceTribe = allTribes?.find((t) => t.tribeId === xSource);
  const targetTribe = allTribes?.find((t) => t.tribeId === xTarget);

  // Auto-select first tribes when loaded
  useMemo(() => {
    if (allTribes?.length && !xSource) {
      setXSource(allTribes[0].tribeId);
      if (allTribes.length > 1) setXTarget(allTribes[1].tribeId);
    }
  }, [allTribes]);

  // Cross-swap breakdown
  const xAmt = Number(xAmount) || 0;
  const xBreakdown = useMemo(() => {
    if (xAmt <= 0) return null;

    if (xMode === "eve-to-tribe") {
      if (!targetTribe?.vault) return null;
      const totalBase = BigInt(Math.floor(xAmt * 1e9));
      const feeBase = totalBase * BigInt(FEE_BPS) / 10000n;
      const backingBase = totalBase - feeBase;
      const creditsBase = backingBase * BigInt(CREDIT_MULTIPLIER);
      const fee = Number(feeBase) / 1e9;
      const creditsOut = Math.floor(Number(creditsBase) / 1e9);
      return {
        rows: [
          { label: "EVE in", value: `${floorTo4(xAmt)} EVE` },
          { label: `Deposit fee (${feePct}%)`, value: `−${floorTo4(fee)} EVE` },
        ],
        totalLabel: `${creditsOut.toLocaleString()} ${targetTribe.ticker}`,
        output: creditsOut.toLocaleString(),
        totalFee: fee,
      };
    }

    // tribe-to-tribe
    if (!sourceTribe?.vault || !targetTribe?.vault) return null;
    const srcVault = sourceTribe.vault;
    if (srcVault.creditSupply <= 0) return null;

    // Step 1: Redeem source credits → EVE
    const creditsBase = BigInt(Math.floor(xAmt * 1e9));
    const eveGross = creditsBase * BigInt(srcVault.eveBacking) / BigInt(srcVault.creditSupply);
    const redeemFee = eveGross * BigInt(FEE_BPS) / 10000n;
    const eveNet = eveGross - redeemFee;

    // Step 2: Deposit EVE → target credits
    const depositFee = eveNet * BigInt(FEE_BPS) / 10000n;
    const eveBacking = eveNet - depositFee;
    const targetCredits = eveBacking * BigInt(CREDIT_MULTIPLIER);

    const redeemFeeNum = Number(redeemFee) / 1e9;
    const depositFeeNum = Number(depositFee) / 1e9;
    const eveNetNum = Number(eveNet) / 1e9;
    const targetCreditsNum = Math.floor(Number(targetCredits) / 1e9);

    return {
      rows: [
        { label: `Redeem ${sourceTribe.ticker}`, value: `${Math.floor(xAmt).toLocaleString()} ${sourceTribe.ticker}` },
        { label: `Redeem fee (${feePct}%)`, value: `−${floorTo4(redeemFeeNum)} EVE` },
        { label: "EVE (intermediate)", value: `${floorTo4(eveNetNum)} EVE` },
        { label: `Deposit fee (${feePct}%)`, value: `−${floorTo4(depositFeeNum)} EVE` },
      ],
      totalLabel: `${targetCreditsNum.toLocaleString()} ${targetTribe.ticker}`,
      output: targetCreditsNum.toLocaleString(),
      totalFee: redeemFeeNum + depositFeeNum,
    };
  }, [xAmt, xMode, sourceTribe, targetTribe, feePct]);

  async function handleCrossSwapExecute() {
    if (!xAmt || xAmt <= 0) return;

    if (xMode === "eve-to-tribe") {
      if (!targetTribe) { setXValidation("Select a target tribe"); return; }
      const success = await buyWithEve(targetTribe, xAmt);
      if (success) { setXAmount(""); setXValidation(null); }
    } else {
      if (!sourceTribe || !targetTribe) { setXValidation("Select both tribes"); return; }
      if (sourceTribe.tribeId === targetTribe.tribeId) { setXValidation("Source and target must differ"); return; }
      const success = await crossSwap(sourceTribe, targetTribe, xAmt);
      if (success) { setXAmount(""); setXValidation(null); }
    }
  }

  // ─── Limit orders ───
  const { data: myOrders } = useMyTribeCoinOrders(account?.address);
  const { placeOrder, cancelOrder } = useTribeCoinOrderMutations();

  return (
    <div className="page-grid">
      {/* Tab bar */}
      <div className="exchange-tabs" style={{ gridColumn: "1 / -1" }}>
        <button className={`exchange-tab-btn${activeTab === "exchange" ? " active" : ""}`} onClick={() => setActiveTab("exchange")}>Exchange</button>
        <button className={`exchange-tab-btn${activeTab === "cross-swap" ? " active" : ""}`} onClick={() => setActiveTab("cross-swap")}>Cross-Swap</button>
        <button className={`exchange-tab-btn${activeTab === "market" ? " active" : ""}`} onClick={() => setActiveTab("market")}>Market Board</button>
        <button className={`exchange-tab-btn${activeTab === "send" ? " active" : ""}`} onClick={() => setActiveTab("send")}>Send</button>
      </div>

      {activeTab === "exchange" && (
      <>
      {/* Left panel — Unified swap */}
      <section className="panel panel-left">
        <h3>Exchange</h3>
        {!account ? (
          <p className="muted">Connect wallet to exchange</p>
        ) : vaultLoading ? (
          <p className="muted">Loading...</p>
        ) : !vault ? (
          <p className="muted">Vault not found</p>
        ) : (
          <>
            {/* Balances */}
            <div className="stat-grid">
              <div className="stat">
                <span className="stat-label">Earned {ticker}</span>
                <span className="stat-value stat-earned">{displayEarned.toLocaleString()}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Wallet {ticker}</span>
                <span className="stat-value">{displayCredits.toLocaleString()}</span>
              </div>
              <div className="stat">
                <span className="stat-label">EVE</span>
                <span className="stat-value">{floorTo4(balances?.eve ?? 0)}</span>
              </div>
              <div className="stat">
                <span className="stat-label">SUI</span>
                <span className="stat-value">{floorTo4(balances?.sui ?? 0)}</span>
              </div>
            </div>

            {/* Swap card */}
            <div className="swap-card">
              {operation && (
                <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
                  {OPERATION_HINTS[operation]}
                </p>
              )}

              {/* FROM */}
              <div className="swap-field">
                <div className="swap-field-header">
                  <label className="fund-label">From</label>
                  <span className="swap-balance">
                    Bal: {fromAsset === "eve" ? floorTo4(fromBalance) : Math.floor(fromBalance).toLocaleString()}
                  </span>
                </div>
                <div className="swap-input-row">
                  <Select
                    className="swap-select"
                    value={fromAsset}
                    onChange={(v) => handleFromChange(v as Asset)}
                    options={[
                      { value: "eve", label: "EVE" },
                      { value: "credits", label: `Wallet ${ticker}` },
                      { value: "earned", label: `Earned ${ticker}` },
                    ]}
                  />
                  <input
                    type="number"
                    min="0"
                    step={fromAsset === "eve" ? "0.01" : "1"}
                    placeholder="0"
                    value={amount}
                    onChange={(e) => handleAmountChange(e.target.value)}
                  />
                  <button
                    className="swap-max-btn"
                    onClick={() => handleAmountChange(
                      fromAsset === "eve" ? floorTo4(fromBalance) : String(Math.floor(fromBalance))
                    )}
                  >
                    MAX
                  </button>
                </div>
              </div>

              {/* Swap direction */}
              <div className="swap-direction">
                <button
                  className={`swap-arrow-btn${canSwap ? "" : " disabled"}`}
                  onClick={handleSwap}
                  disabled={!canSwap}
                  title={canSwap ? "Swap direction" : ""}
                >
                  ⇅
                </button>
              </div>

              {/* TO */}
              <div className="swap-field">
                <div className="swap-field-header">
                  <label className="fund-label">To</label>
                </div>
                <div className="swap-input-row">
                  <Select
                    className="swap-select"
                    value={toAsset}
                    onChange={(v) => { setToAsset(v as Asset); setAmount(""); setValidation(null); }}
                    options={VALID_PAIRS[fromAsset].map((a) => ({ value: a, label: ASSET_LABELS[a] }))}
                  />
                  <input
                    type="text"
                    readOnly
                    className="swap-output"
                    value={breakdown?.output ?? "0"}
                  />
                </div>
              </div>

              {/* Breakdown */}
              {breakdown && breakdown.rows.length > 0 && (
                <div className="order-summary">
                  {breakdown.rows.map((r, i) => (
                    <div key={i} className="order-summary-row">
                      <span>{r.label}</span>
                      <span>{r.value}</span>
                    </div>
                  ))}
                  <div className="order-summary-row total">
                    <span>You receive</span>
                    <span>{breakdown.total}</span>
                  </div>
                </div>
              )}

              {/* Validation / errors / success */}
              {validation && <p className="input-error">{validation}</p>}
              {activeError && <p className="error">{activeError}</p>}
              {activeDigest && <p className="success"><a href={`https://suiscan.xyz/${SUI_NETWORK}/tx/${activeDigest}`} target="_blank" rel="noopener noreferrer">TX: {activeDigest.slice(0, 16)}...</a></p>}

              <button
                className="btn-primary btn-place-order"
                disabled={!operation || activePending || !amount || Number(amount) <= 0 || !!validation}
                onClick={handleExecute}
              >
                {activePending ? "Processing…" : operation ? OPERATION_LABELS[operation] : "Select assets"}
              </button>
            </div>
          </>
        )}
      </section>

      {/* Right panel — Tribe info */}
      <section className="panel panel-right">
        <h3>{tribeName}</h3>
        {vault ? (
          <div className="tribe-card">
            <div className="tribe-card-header">
              <span className="tribe-name">{tribeName}</span>
              <span className="tribe-ratio">1 EVE = {CREDIT_MULTIPLIER} {ticker}</span>
            </div>
            <div className="tribe-bar-bg">
              <div
                className="tribe-bar-fill"
                style={{ width: `${Math.min((vault.eveBacking / (vault.creditSupply / CREDIT_MULTIPLIER || 1)) * 100, 100)}%` }}
              />
            </div>
            <div className="tribe-card-stats">
              <span>{(vault.eveBacking / 1e9).toLocaleString()} EVE locked</span>
              <span>{(vault.creditSupply / 1e9).toLocaleString()} {ticker}</span>
            </div>
          </div>
        ) : (
          <p className="muted">Loading tribe data...</p>
        )}
        {/* Other tribes */}
        {allTribes && allTribes.filter((t) => t.tribeId !== String(TRIBE_ID)).length > 0 && (
          <>
            <h4 style={{ marginTop: "1.5rem" }}>Other Tribes</h4>
            {allTribes
              .filter((t) => t.tribeId !== String(TRIBE_ID))
              .map((t) => {
                const ratio = t.vault
                  ? t.vault.creditSupply > 0
                    ? t.vault.eveBacking / t.vault.creditSupply
                    : 1
                  : null;
                const healthPct = ratio !== null ? Math.min(ratio * 100, 100) : 0;
                return (
                  <div className="tribe-card" key={t.tribeId} style={{ marginTop: "0.75rem", opacity: 0.9 }}>
                    <div className="tribe-card-header">
                      <span className="tribe-name">{t.tribeName ?? t.ticker}</span>
                      <span className="tribe-ratio">{t.ticker}</span>
                    </div>
                    {t.vault && (
                      <>
                        <div className="tribe-bar-bg">
                          <div className="tribe-bar-fill" style={{ width: `${healthPct}%` }} />
                        </div>
                        <div className="tribe-card-stats">
                          <span>{(t.vault.eveBacking / 1e9).toLocaleString()} EVE</span>
                          <span>{(t.vault.creditSupply / 1e9).toLocaleString()} {t.ticker}</span>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
          </>
        )}
        {tribesLoading && <p className="muted" style={{ marginTop: "1rem", textAlign: "center" }}>Loading tribes...</p>}
        {!tribesLoading && (!allTribes || allTribes.filter((t) => t.tribeId !== String(TRIBE_ID)).length === 0) && (
          <p className="muted" style={{ marginTop: "2rem", textAlign: "center" }}>No other tribes found</p>
        )}
      </section>
      </>
      )}

      {activeTab === "cross-swap" && (
      <>
      {/* Left panel — Cross-Swap */}
      <section className="panel panel-left">
        <h3>Cross-Tribe Swap</h3>
        {!account ? (
          <p className="muted">Connect wallet to swap</p>
        ) : tribesLoading ? (
          <p className="muted">Loading tribes…</p>
        ) : !allTribes?.length ? (
          <p className="muted">No tribes with active vaults found.</p>
        ) : allTribes.length < 2 && xMode === "tribe-to-tribe" ? (
          <>
            <div className="swap-mode-row">
              <button className="swap-mode-btn active" onClick={() => { setXMode("tribe-to-tribe"); setXAmount(""); setXValidation(null); }}>
                Tribe → Tribe
              </button>
              <button className="swap-mode-btn" onClick={() => { setXMode("eve-to-tribe"); setXAmount(""); setXValidation(null); }}>
                EVE → Tribe
              </button>
            </div>
            <p className="muted">Tribe-to-tribe swaps require at least two tribes with active vaults. Use EVE → Tribe mode instead.</p>
          </>
        ) : (
          <>
            {/* Mode selector */}
            <div className="swap-mode-row">
              <button className={`swap-mode-btn${xMode === "tribe-to-tribe" ? " active" : ""}`} onClick={() => { setXMode("tribe-to-tribe"); setXAmount(""); setXValidation(null); }}>
                Tribe → Tribe
              </button>
              <button className={`swap-mode-btn${xMode === "eve-to-tribe" ? " active" : ""}`} onClick={() => { setXMode("eve-to-tribe"); setXAmount(""); setXValidation(null); }}>
                EVE → Tribe
              </button>
            </div>

            <div className="swap-card">
              {/* Source */}
              {xMode === "tribe-to-tribe" && (
                <div className="swap-field">
                  <div className="swap-field-header">
                    <label className="fund-label">From Tribe</label>
                  </div>
                  <div className="swap-input-row">
                    <Select
                      className="swap-select"
                      style={{ flex: 1 }}
                      value={xSource}
                      onChange={(v) => { setXSource(v); setXAmount(""); setXValidation(null); }}
                      options={allTribes.map((t) => ({ value: t.tribeId, label: `${t.tribeName ?? t.ticker} (${t.ticker})` }))}
                    />
                  </div>
                </div>
              )}

              {/* Amount */}
              <div className="swap-field">
                <div className="swap-field-header">
                  <label className="fund-label">{xMode === "eve-to-tribe" ? "EVE Amount" : `${sourceTribe?.ticker ?? "Credits"} Amount`}</label>
                </div>
                <div className="swap-input-row">
                  <input
                    type="number"
                    min="0"
                    step={xMode === "eve-to-tribe" ? "0.01" : "1"}
                    placeholder="0"
                    value={xAmount}
                    onChange={(e) => { setXAmount(e.target.value); setXValidation(null); }}
                  />
                </div>
              </div>

              {/* Direction indicator */}
              <div className="swap-direction">
                <span className="swap-arrow-label">↓</span>
              </div>

              {/* Target */}
              <div className="swap-field">
                <div className="swap-field-header">
                  <label className="fund-label">To Tribe</label>
                </div>
                <div className="swap-input-row">
                  <Select
                    className="swap-select"
                    style={{ flex: 1 }}
                    value={xTarget}
                    onChange={(v) => { setXTarget(v); setXAmount(""); setXValidation(null); }}
                    options={allTribes.filter((t) => xMode === "eve-to-tribe" || t.tribeId !== xSource).map((t) => ({ value: t.tribeId, label: `${t.tribeName ?? t.ticker} (${t.ticker})` }))}
                  />
                </div>
              </div>

              {/* Breakdown */}
              {xBreakdown && (
                <div className="order-summary">
                  {xBreakdown.rows.map((r, i) => (
                    <div key={i} className="order-summary-row">
                      <span>{r.label}</span>
                      <span>{r.value}</span>
                    </div>
                  ))}
                  <div className="order-summary-row total">
                    <span>You receive</span>
                    <span>{xBreakdown.totalLabel}</span>
                  </div>
                </div>
              )}

              {xValidation && <p className="input-error">{xValidation}</p>}
              {xError && <p className="error">{xError}</p>}
              {xDigest && <p className="success"><a href={`https://suiscan.xyz/${SUI_NETWORK}/tx/${xDigest}`} target="_blank" rel="noopener noreferrer">TX: {xDigest.slice(0, 16)}…</a></p>}

              <button
                className="btn-primary btn-place-order"
                disabled={xPending || !xAmount || xAmt <= 0 || (xMode === "tribe-to-tribe" && xSource === xTarget)}
                onClick={handleCrossSwapExecute}
              >
                {xPending ? "Processing…" : xMode === "eve-to-tribe" ? `Buy ${targetTribe?.ticker ?? "Credits"}` : "Swap"}
              </button>
            </div>
          </>
        )}
      </section>

      {/* Right panel — My open orders */}
      <section className="panel panel-right">
        <h3>My Limit Orders</h3>
        {!account ? (
          <p className="muted">Connect wallet</p>
        ) : !myOrders?.length ? (
          <p className="muted">No open orders</p>
        ) : (
          <div className="tribe-orders-list">
            {myOrders.map((o) => (
              <div key={o.id} className="tribe-order-row">
                <div className="tribe-order-info">
                  <span className="tribe-order-pair">{o.sourceTribeId} → {o.targetTribeId}</span>
                  <span className="tribe-order-qty">{o.quantity.toLocaleString()} @ {o.limitRate.toFixed(4)}</span>
                  <span className={`tribe-order-status status-${o.status}`}>{o.status}</span>
                </div>
                {o.status === "open" && (
                  <button className="tribe-order-cancel" onClick={() => cancelOrder(o.id)}>Cancel</button>
                )}
              </div>
            ))}
          </div>
        )}

        <h4 style={{ marginTop: "1.5rem" }}>Place Limit Order</h4>
        {tribesLoading ? (
          <p className="muted">Loading tribes…</p>
        ) : allTribes && allTribes.length >= 2 ? (
          <LimitOrderForm tribes={allTribes} account={account} placeOrder={placeOrder} playerName={character?.name} />
        ) : (
          <p className="muted">Cross-tribe limit orders require at least two tribes with active vaults.</p>
        )}
      </section>
      </>
      )}

      {activeTab === "market" && (
        <section className="panel" style={{ gridColumn: "1 / -1" }}>
          <TribeMarketBoard onSelect={(tribe) => {
            setXTarget(tribe.tribeId);
            setActiveTab("cross-swap");
          }} />
        </section>
      )}

      {activeTab === "send" && (
        <section className="panel" style={{ gridColumn: "1 / -1", maxWidth: 520, margin: "0 auto" }}>
          <SendTokensPanel
            ticker={ticker}
            displayCredits={displayCredits}
          />
        </section>
      )}
    </div>
  );
}

/* ─── Limit Order Form (local sub-component) ─── */
function LimitOrderForm({
  tribes,
  account,
  placeOrder,
  playerName,
}: {
  tribes: TribeInfo[];
  account: ReturnType<typeof useCurrentAccount>;
  placeOrder: (order: {
    wallet: string;
    playerName: string;
    sourceTribeId: string;
    targetTribeId: string;
    side: string;
    quantity: number;
    limitRate: number;
  }) => Promise<boolean>;
  playerName?: string;
}) {
  const [src, setSrc] = useState(tribes[0]?.tribeId ?? "");
  const [tgt, setTgt] = useState(tribes[1]?.tribeId ?? "");
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handlePlace() {
    if (!account || !qty || !rate) return;
    setSubmitting(true);
    try {
      await placeOrder({
        wallet: account.address,
        playerName: playerName ?? account.address.slice(0, 8),
        sourceTribeId: src,
        targetTribeId: tgt,
        side,
        quantity: Number(qty),
        limitRate: Number(rate),
      });
      setQty("");
      setRate("");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="limit-order-form">
      <div className="limit-order-row">
        <Select
          className="swap-select"
          style={{ flex: 1 }}
          value={src}
          onChange={(v) => setSrc(v)}
          options={tribes.map((t) => ({ value: t.tribeId, label: t.ticker }))}
        />
        <span className="limit-order-arrow">→</span>
        <Select
          className="swap-select"
          style={{ flex: 1 }}
          value={tgt}
          onChange={(v) => setTgt(v)}
          options={tribes.filter((t) => t.tribeId !== src).map((t) => ({ value: t.tribeId, label: t.ticker }))}
        />
      </div>
      <div className="limit-order-row">
        <button className={`swap-mode-btn${side === "buy" ? " active" : ""}`} onClick={() => setSide("buy")}>Buy</button>
        <button className={`swap-mode-btn${side === "sell" ? " active" : ""}`} onClick={() => setSide("sell")}>Sell</button>
      </div>
      <div className="limit-order-row">
        <input type="number" min="0" step="1" placeholder="Quantity" value={qty} onChange={(e) => setQty(e.target.value)} />
        <input type="number" min="0" step="0.0001" placeholder="Limit rate" value={rate} onChange={(e) => setRate(e.target.value)} />
      </div>
      <button className="btn-primary" disabled={submitting || !qty || !rate || src === tgt} onClick={handlePlace}>
        {submitting ? "Placing…" : "Place Order"}
      </button>
    </div>
  );
}

/* ─── Send Tokens Panel (local sub-component) ─── */
function SendTokensPanel({
  ticker,
  displayCredits,
}: {
  ticker: string;
  displayCredits: number;
}) {
  const account = useCurrentAccount();
  const { signAndExecuteTransaction } = useDAppKit();
  const { config } = useDeploymentConfig();

  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolvedTribe, setResolvedTribe] = useState<string | null>(null);
  const [lookupPending, setLookupPending] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ digest: string } | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  async function handleLookup() {
    const addr = recipient.trim();
    if (!addr) return;
    setLookupPending(true);
    setLookupError(null);
    setResolvedName(null);
    setResolvedTribe(null);
    try {
      const char = await fetchCharacter(addr);
      if (char) {
        setResolvedName(char.name);
        setResolvedTribe(char.tribeName ?? null);
      } else {
        setResolvedName(null);
        setResolvedTribe(null);
        setLookupError("No character found for this address.");
      }
    } catch {
      setLookupError("Failed to look up character.");
    } finally {
      setLookupPending(false);
    }
  }

  function handleConfirmOpen() {
    setSendError(null);
    setResult(null);
    setShowConfirm(true);
  }

  async function handleSend() {
    if (!account || !config?.creditCoinType) return;
    const addr = recipient.trim();
    const parsedAmount = parseFloat(amount);
    if (!addr || isNaN(parsedAmount) || parsedAmount <= 0) return;

    setSending(true);
    setSendError(null);
    setResult(null);
    try {
      const amountBase = BigInt(Math.floor(parsedAmount * DECIMALS));
      const tx = new Transaction();

      const coins = await rpc.getCoins({
        owner: account.address,
        coinType: config.creditCoinType,
      });

      if (!coins.data.length) {
        setSendError(`No ${ticker} coins found in wallet.`);
        setSending(false);
        return;
      }

      const primaryCoinId = coins.data[0].coinObjectId;
      if (coins.data.length > 1) {
        tx.mergeCoins(
          tx.object(primaryCoinId),
          coins.data.slice(1).map((c) => tx.object(c.coinObjectId)),
        );
      }
      const [sendCoin] = tx.splitCoins(tx.object(primaryCoinId), [tx.pure.u64(amountBase)]);
      tx.transferObjects([sendCoin], tx.pure.address(addr));

      const txResult = await signAndExecuteTransaction({ transaction: tx });

      if (txResult.$kind === "Transaction") {
        setResult({ digest: txResult.Transaction.digest });
        setShowConfirm(false);
        setAmount("");
      } else {
        setSendError("Transaction failed on-chain.");
      }
    } catch (err: unknown) {
      setSendError(err instanceof Error ? err.message : "Transaction failed.");
    } finally {
      setSending(false);
    }
  }

  const parsedAmount = parseFloat(amount);
  const validAmount = !isNaN(parsedAmount) && parsedAmount > 0 && parsedAmount <= displayCredits;
  const canProceed = recipient.trim().length > 0 && validAmount && resolvedName !== null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h3 style={{ margin: 0 }}>Send {ticker}</h3>

      <label style={{ fontSize: 12, opacity: 0.7 }}>Recipient address</label>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          type="text"
          placeholder="0x…"
          value={recipient}
          onChange={(e) => {
            setRecipient(e.target.value);
            setResolvedName(null);
            setResolvedTribe(null);
            setLookupError(null);
            setShowConfirm(false);
            setResult(null);
            setSendError(null);
          }}
          style={{ flex: 1 }}
        />
        <button
          className="btn-primary"
          disabled={!recipient.trim() || lookupPending}
          onClick={handleLookup}
          style={{ whiteSpace: "nowrap" }}
        >
          {lookupPending ? "Looking up…" : "Look up"}
        </button>
      </div>

      {lookupError && <div className="error-msg">{lookupError}</div>}

      {resolvedName && (
        <div className="breakdown-row" style={{ background: "var(--bg-card, #1a1a2e)", borderRadius: 6, padding: "8px 12px" }}>
          <span style={{ opacity: 0.7 }}>Character:</span>{" "}
          <strong>{resolvedName}</strong>
          {resolvedTribe && <span style={{ marginLeft: 8, opacity: 0.6 }}>({resolvedTribe})</span>}
        </div>
      )}

      <label style={{ fontSize: 12, opacity: 0.7 }}>Amount ({ticker})</label>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="number"
          min="0"
          step="0.001"
          placeholder="0.00"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setShowConfirm(false);
            setResult(null);
            setSendError(null);
          }}
          style={{ flex: 1 }}
        />
        <span style={{ fontSize: 12, opacity: 0.6 }}>Balance: {floorTo4(displayCredits)}</span>
      </div>

      {!showConfirm && (
        <button className="btn-primary" disabled={!canProceed} onClick={handleConfirmOpen}>
          Continue
        </button>
      )}

      {showConfirm && (
        <div style={{ background: "var(--bg-card, #1a1a2e)", borderRadius: 8, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <h4 style={{ margin: 0 }}>Confirm Transfer</h4>
          <p style={{ margin: 0, fontSize: 14 }}>
            Send <strong>{parsedAmount} {ticker}</strong> to <strong>{resolvedName}</strong>
            {resolvedTribe && <> ({resolvedTribe})</>}
          </p>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.7 }}>
            {recipient.trim()}
          </p>
          <p style={{ margin: 0, fontSize: 12, opacity: 0.7, lineHeight: 1.5 }}>
            A small SUI gas fee (typically &lt; 0.01 SUI) will be deducted from your SUI balance
            to process this transaction on the Sui blockchain. The {ticker} tokens are sent
            directly from your wallet to the recipient — no additional fees apply.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-primary" disabled={sending} onClick={handleSend}>
              {sending ? "Sending…" : "Confirm & Send"}
            </button>
            <button className="btn-secondary" disabled={sending} onClick={() => setShowConfirm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {sendError && <div className="error-msg">{sendError}</div>}

      {result && (
        <div style={{ background: "var(--bg-card, #1a1a2e)", borderRadius: 8, padding: 12, fontSize: 13 }}>
          Transfer successful!{" "}
          <a
            href={`https://suiscan.xyz/${SUI_NETWORK}/tx/${result.digest}`}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent, #4dabf7)" }}
          >
            View transaction
          </a>
        </div>
      )}
    </div>
  );
}
