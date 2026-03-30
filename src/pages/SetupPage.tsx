import { useState, useRef, useEffect, useCallback } from "react";
import { useWallets, useDAppKit } from "@mysten/dapp-kit-react";
import { abbreviateAddress, useConnection } from "@evefrontier/dapp-kit";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { useCharacter } from "../hooks/useCharacter";
import { useVaultId } from "../hooks/useVaultId";
import { useDeploymentConfig, type DeploymentConfig } from "../context/DeploymentContext";
import {
  VAULT_COIN_TYPE,
  SUI_RPC_URL,
  SUI_NETWORK,
  DEFAULT_DEPLOYMENT,
  EXTENSION_PACKAGE_ID,
  WORLD_API,
} from "../config";
import { friendlyTxError } from "../utils/friendlyTxError";
import { verifyNetworkNode } from "../hooks/useNetworkNodeFuel";
import {
  buildPublishCoinTransaction,
  extractPublishResult,
  buildCreateVaultTransaction,
  extractVaultId,
} from "../lib/publishTribeCoin";

const rpc = new SuiJsonRpcClient({ url: SUI_RPC_URL, network: SUI_NETWORK });

interface SetupPageProps {
  onComplete: (ssuId: string, ownerAddress: string, ssuTribeId: string) => void;
}

export function SetupPage({ onComplete }: SetupPageProps) {
  // ── Wallet connection ──
  const { currentAccount: account, isConnected, hasEveVault, handleConnect, handleDisconnect } = useConnection();
  const wallets = useWallets();
  const { connectWallet, signAndExecuteTransaction } = useDAppKit();
  const [showPicker, setShowPicker] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // ── Character ──
  const { data: character, isLoading: charLoading } = useCharacter(account?.address);

  // ── Deployment config (fetched dynamically per tribe) ──
  const { config: deploymentConfig, isConfigured, loading: configLoading, saveConfig } = useDeploymentConfig();

  // ── Dynamic vault ID from on-chain registry ──
  const { data: registryVaultId } = useVaultId(character?.tribeId);

  // ── SSU ID: manual paste only ──
  const [manualSsuId, setManualSsuId] = useState("");
  const ssuId = manualSsuId.trim();

  // ── Network Node input (prompted if none stored) ──
  const [needsNetworkNode, setNeedsNetworkNode] = useState(false);
  const [networkNodeInput, setNetworkNodeInput] = useState("");
  const [networkNodeStatus, setNetworkNodeStatus] = useState<{ type: "info" | "success" | "error"; message: string } | null>(null);
  const [networkNodeSkipped, setNetworkNodeSkipped] = useState(false);

  // ── Location input (required for first-time SSU setup) ──
  const [needsLocation, setNeedsLocation] = useState(false);
  const [locationInput, setLocationInput] = useState("");
  const [lpointP, setLpointP] = useState("");
  const [lpointL, setLpointL] = useState("");

  // ── Setup progress ──
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Auto-connect in-game wallet
  const autoConnectAttempted = useRef(false);
  useEffect(() => {
    if (isConnected || autoConnectAttempted.current) return;
    if (hasEveVault) {
      autoConnectAttempted.current = true;
      handleConnect();
    }
  }, [hasEveVault, isConnected, handleConnect]);

  // Close wallet picker on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    if (showPicker) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [showPicker]);

  function handleWalletClick() {
    if (isConnected) {
      handleDisconnect();
    } else if (hasEveVault) {
      handleConnect();
    } else {
      setShowPicker((prev) => !prev);
    }
  }

  // ── Single "Confirm" handler that auto-provisions everything ──
  const handleConfirm = useCallback(async function handleConfirm() {
    if (!ssuId || !account || !character) return;
    setBusy(true);
    setError(null);

    try {
      // Step 1: Ensure deployment config has at least packageId/registryId
      // Merge defaults under existing config so we never overwrite coin info
      let cfg = deploymentConfig;
      if (!cfg || !cfg.packageId) {
        setStatus("Registering deployment for your tribe…");
        cfg = { ...DEFAULT_DEPLOYMENT, ...(cfg ?? {}) } as DeploymentConfig;
        await saveConfig(cfg);
      } else if (!cfg.creditCoinType && DEFAULT_DEPLOYMENT.packageId === cfg.packageId) {
        // Config exists but coin fields are missing — fill from defaults without overwriting
        cfg = { ...DEFAULT_DEPLOYMENT, ...cfg } as DeploymentConfig;
      }

      // Step 2: Check if SSU already configured for this tribe
      setStatus("Checking SSU…");
      const ssuRes = await fetch(
        `/api/ssu?ssuId=${encodeURIComponent(ssuId)}&tribeId=${character.tribeId}`,
      );
      const ssuData = await ssuRes.json();
      const ssuAlreadyRegistered = !!(ssuData && ssuData.ssuId);

      // If SSU is NOT registered for user's tribe, check if it exists for ANY tribe.
      // If so, this user is a visitor — skip all setup and go straight to the main page.
      if (!ssuAlreadyRegistered) {
        const anyRes = await fetch(`/api/ssu?ssuId=${encodeURIComponent(ssuId)}`);
        const anyData = await anyRes.json();
        if (anyData && anyData.ssuId) {
          // SSU belongs to another tribe — user is a visitor
          onComplete(ssuId, anyData.activatedBy, String(anyData.tribeId));
          return;
        }
      }

      // Step 2b: Check if network node is linked
      if (!networkNodeSkipped) {
        const nnRes = await fetch(
          `/api/network-settings?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(character.tribeId)}`,
        );
        const nnData = await nnRes.json();
        if (!nnData?.networkNodeId) {
          // No network node stored — pause and ask the user (unless already showing prompt)
          if (!needsNetworkNode) {
            setNeedsNetworkNode(true);
            setBusy(false);
            setStatus("");
            return;
          }
          // User submitted a network node ID — verify & save it
          const nnId = networkNodeInput.trim();
          if (nnId) {
            setStatus("Verifying network node…");
            await verifyNetworkNode(nnId);
            setStatus("Saving network node…");
            const nnSaveRes = await fetch(
              `/api/network-settings?ssuId=${encodeURIComponent(ssuId)}&tribeId=${encodeURIComponent(character.tribeId)}`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ssuId,
                  tribeId: String(character.tribeId),
                  visibility: nnData?.visibility ?? "tribal",
                  locationPolicy: nnData?.locationPolicy ?? "manual",
                  networkNodeId: nnId,
                }),
              },
            );
            if (!nnSaveRes.ok) throw new Error("Failed to save network node");
          }
        }
      }

      // Step 2c: Check if location is stored (for both new AND existing SSUs)
      const locRes = await fetch(
        `/api/ssu-location?ssuId=${encodeURIComponent(ssuId)}&tribeId=${character.tribeId}`,
      );
      const locData = await locRes.json();
      if (!locData || !locData.solarSystemId) {
        // No location stored — pause and ask the user
        if (!needsLocation) {
          setNeedsLocation(true);
          setBusy(false);
          setStatus("");
          return;
        }
        // User has entered a solar system name — look it up via World API
        const systemName = locationInput.trim();
        if (!systemName) {
          throw new Error("Please enter a solar system name (e.g. ERR-HSD)");
        }
        setStatus("Looking up solar system…");
        const lookupRes = await fetch(
          `/api/solar-system-lookup?name=${encodeURIComponent(systemName)}`,
        );
        const lookupData = await lookupRes.json();
        if (!lookupRes.ok || !lookupData.solarSystemId) {
          throw new Error(lookupData.error || `Solar system "${systemName}" not found`);
        }
        setStatus("Saving location…");
        const locSaveRes = await fetch(
          `/api/ssu-location?ssuId=${encodeURIComponent(ssuId)}&tribeId=${character.tribeId}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ssuId,
              tribeId: String(character.tribeId),
              solarSystemId: lookupData.solarSystemId,
              solarSystemName: lookupData.solarSystemName,
              locationX: lookupData.locationX,
              locationY: lookupData.locationY,
              locationZ: lookupData.locationZ,
              pNum: lpointP.trim(),
              lNum: lpointL.trim(),
              createdBy: account.address,
            }),
          },
        );
        if (!locSaveRes.ok) throw new Error("Failed to save location");
      }

      // Recover missing coin info from on-chain vault if config is incomplete
      if (cfg && !cfg.creditCoinType && ssuData?.vaultObjectId) {
        try {
          const vObj = await rpc.getObject({ id: ssuData.vaultObjectId, options: { showType: true } });
          const vType = (vObj.data as { type?: string })?.type ?? "";
          // Type is "pkg::vault::TribeVault<EVE_TYPE, CREDIT_TYPE>"
          const typeMatch = vType.match(/,\s*(0x[^>]+)/);
          if (typeMatch) {
            const creditCoinType = typeMatch[1];
            const coinPkgMatch = creditCoinType.match(/^(0x[a-f0-9]+)::/);
            const coinPkg = coinPkgMatch?.[1] ?? "";
            // Look up CoinMetadata
            let metaId = "";
            try {
              const meta = await rpc.getCoinMetadata({ coinType: creditCoinType });
              metaId = (meta as { id?: string })?.id ?? "";
            } catch { /* best-effort */ }
            const recovered = { ...cfg, creditCoinType, coinPackageId: coinPkg, creditMetadataId: metaId };
            await saveConfig(recovered);
            cfg = recovered;
            console.log("[setup] Recovered coin info from on-chain vault:", creditCoinType);
          }
        } catch (e) {
          console.warn("[setup] Coin info recovery failed:", (e as Error).message);
        }
      }

      // Already-registered SSU with location now ensured — skip to main page
      if (ssuAlreadyRegistered) {
        onComplete(ssuId, ssuData.activatedBy ?? account.address, String(ssuData.tribeId ?? character.tribeId));
        return;
      }

      // Step 3: Ensure tribe vault exists (create if needed)
      setStatus("Setting up tribe vault…");
      let vaultObjectId = registryVaultId ?? "";

      if (!vaultObjectId) {
        // Try to create the vault on-chain via publish coin + create vault
        try {
          let coinName = character.tribeName ?? `Tribe ${character.tribeId}`;
          let coinSymbol = "TCREDIT";
          try {
            if (!WORLD_API) throw new Error("No World API configured");
            const tribeRes = await fetch(
              `${WORLD_API}/v2/tribes/${character.tribeId}`,
            );
            const tribe: { id: number; nameShort: string; name: string } = await tribeRes.json();
            if (tribe && tribe.nameShort) {
              coinSymbol = tribe.nameShort;
              coinName = `${tribe.name} Credits`;
            }
          } catch { /* non-fatal */ }

          // Step A: Publish the tribe's unique coin module
          setStatus("Publishing tribe coin…");
          const publishTx = buildPublishCoinTransaction(
            coinSymbol,
            coinName,
            account.address,
          );
          const publishResult = await signAndExecuteTransaction({
            transaction: publishTx,
          });
          if (publishResult.$kind !== "Transaction") {
            throw new Error("Coin publish transaction failed on-chain");
          }
          const publishDigest = publishResult.Transaction.digest;
          await rpc.waitForTransaction({ digest: publishDigest });
          const publishDetail = await rpc.getTransactionBlock({
            digest: publishDigest,
            options: { showObjectChanges: true },
          });
          const coinInfo = extractPublishResult(publishDetail, coinSymbol);

          // Step B: Create the vault using the TreasuryCap
          setStatus("Creating tribe vault…");
          const vaultTx = buildCreateVaultTransaction({
            plutarchPackageId: cfg.packageId,
            registryId: cfg.registryId,
            tribeId: character.tribeId,
            treasuryCapId: coinInfo.treasuryCapId,
            backingCoinType: VAULT_COIN_TYPE,
            creditCoinType: coinInfo.creditCoinType,
          });
          const vaultResult = await signAndExecuteTransaction({
            transaction: vaultTx,
          });
          if (vaultResult.$kind !== "Transaction") {
            throw new Error("Vault creation transaction failed on-chain");
          }
          const vaultDigest = vaultResult.Transaction.digest;
          await rpc.waitForTransaction({ digest: vaultDigest });
          const vaultDetail = await rpc.getTransactionBlock({
            digest: vaultDigest,
            options: { showObjectChanges: true },
          });
          vaultObjectId = extractVaultId(vaultDetail)?.vaultId ?? "";

          // Update deployment config with the new coin info
          await saveConfig({
            ...cfg,
            coinPackageId: coinInfo.coinPackageId,
            creditCoinType: coinInfo.creditCoinType,
            creditMetadataId: coinInfo.creditMetadataId,
          });
        } catch (e) {
          const msg = (e as Error).message;
          // "already exists" means registry still has old entry — admin needs to run reset-tribe-vault
          if (msg.includes("EVaultAlreadyExists") || msg.includes("already exists")) {
            throw new Error(
              "A vault already exists for this tribe in the on-chain registry. " +
              "An admin must run `pnpm reset-tribe-vault` to clear the old entry before re-creating.",
            );
          }
          throw e;
        }
      }

      // Step 4: Authorize the storage extension on this SSU (if not already done)
      setStatus("Authorizing item transfer extension…");
      try {
        const WORLD_PKG = import.meta.env.VITE_EVE_WORLD_PACKAGE_ID as string;
        const { Transaction } = await import("@mysten/sui/transactions");
        const { resolveSsuObjectId } = await import("../hooks/useSsuInventory");
        const ssuObjectId = await resolveSsuObjectId(ssuId);

        // Fetch SSU object — get owner_cap_id and check extension status
        const ssuObj = await rpc.getObject({
          id: ssuObjectId,
          options: { showContent: true },
        });
        const ssuFields = (ssuObj.data?.content as { fields?: Record<string, unknown> })?.fields;
        const extensionSet = ssuFields?.extension != null;
        const capId = ssuFields?.owner_cap_id as string | undefined;

        if (!extensionSet && capId && character.objectId) {
          const authTx = new Transaction();

          // Borrow OwnerCap<StorageUnit> from Character
          const [borrowedCap, receipt] = authTx.moveCall({
            target: `${WORLD_PKG}::character::borrow_owner_cap`,
            typeArguments: [`${WORLD_PKG}::storage_unit::StorageUnit`],
            arguments: [
              authTx.object(character.objectId),  // &mut Character
              authTx.object(capId),               // Receiving<OwnerCap<StorageUnit>>
            ],
          });

          // Authorize extension
          authTx.moveCall({
            target: `${WORLD_PKG}::storage_unit::authorize_extension`,
            typeArguments: [`${EXTENSION_PACKAGE_ID}::storage_unit_extension::TribeAuth`],
            arguments: [
              authTx.object(ssuObjectId),  // &mut StorageUnit
              borrowedCap,                 // &OwnerCap<StorageUnit>
            ],
          });

          // Return OwnerCap<StorageUnit> back to Character
          authTx.moveCall({
            target: `${WORLD_PKG}::access::return_owner_cap_to_object`,
            typeArguments: [`${WORLD_PKG}::storage_unit::StorageUnit`],
            arguments: [
              borrowedCap,                             // OwnerCap<StorageUnit>
              receipt,                                 // ReturnOwnerCapReceipt
              authTx.pure.address(character.objectId), // owner_id
            ],
          });

          const authResult = await signAndExecuteTransaction({ transaction: authTx });
          if (authResult.$kind === "Transaction") {
            console.log("[setup] Extension authorized:", authResult.Transaction.digest);
          }
        }
      } catch (e) {
        console.warn("[setup] Extension auth skipped:", (e as Error).message);
        // Non-fatal — can be retried later
      }

      // Step 5: Save SSU config and proceed
      setStatus("Activating SSU…");
      const { anonSsuName } = await import("../utils/ssuNames");
      const ssuPayload = {
        ssuId,
        hubName: anonSsuName(ssuId),
        tribeId: String(character.tribeId),
        tribeName: character.tribeName,
        activatedAt: new Date().toISOString(),
        activatedBy: account.address,
        characterName: character.name,
        vaultObjectId,
      };
      const saveRes = await fetch(
        `/api/ssu?ssuId=${encodeURIComponent(ssuId)}&tribeId=${character.tribeId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(ssuPayload),
        },
      );
      if (!saveRes.ok) throw new Error("Failed to save SSU setup");

      try { localStorage.removeItem("plutarch:lastSsuId"); } catch {}
      onComplete(ssuId, account.address, String(character.tribeId));
    } catch (e) {
      setError(friendlyTxError(e));
    } finally {
      setBusy(false);
      setStatus("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ssuId, account, character, deploymentConfig, registryVaultId, needsNetworkNode, networkNodeInput, networkNodeSkipped, needsLocation, locationInput, signAndExecuteTransaction, saveConfig, onComplete]);

  const canConfirm =
    isConnected &&
    !!character &&
    ssuId.length > 2 &&
    ssuId.startsWith("0x") &&
    !busy &&
    !configLoading;

  return (
    <div className="setup-page">
      <div className="setup-card">
        <h2 className="setup-title">PLUTARCH</h2>
        <p className="setup-subtitle">SSU Mission Hub Setup</p>

        {/* ── Step 1: Wallet Connection ── */}
        <div className="setup-section">
          <h4 className="setup-step-title">1. Connect Wallet</h4>
          <div className="wallet-container" ref={pickerRef} style={{ position: "relative" }}>
            <button className="btn-primary setup-btn" onClick={handleWalletClick}>
              {isConnected ? "Disconnect" : "Connect Wallet"}
            </button>
            {showPicker && !isConnected && (
              <div className="wallet-picker" style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0 }}>
                {wallets.length === 0 ? (
                  <div className="wallet-picker-empty">
                    No Sui wallets detected.<br />
                    Install <a href="https://slush.app" target="_blank" rel="noopener noreferrer">Slush</a> or use the Eve Vault in-game client.
                  </div>
                ) : (
                  wallets.map((w) => (
                    <button
                      key={w.name}
                      className="wallet-picker-item"
                      onClick={async () => {
                        setShowPicker(false);
                        try { await connectWallet({ wallet: w }); } catch { /* ignore */ }
                      }}
                    >
                      {w.icon && <img src={w.icon} alt="" className="wallet-icon" />}
                      {w.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          {isConnected && account && (
            <p className="muted" style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
              {abbreviateAddress(account.address)}
            </p>
          )}
        </div>

        {/* ── Step 2: Character & Tribe (auto-detected) ── */}
        {isConnected && (
          <div className="setup-section">
            <h4 className="setup-step-title">2. Character &amp; Tribe</h4>
            {charLoading || configLoading ? (
              <p className="muted">Looking up character…</p>
            ) : character ? (
              <div className="setup-character-info">
                <div className="setup-field">
                  <span className="setup-label">Character</span>
                  <span className="setup-value">{character.name}</span>
                </div>
                <div className="setup-field">
                  <span className="setup-label">Tribe</span>
                  <span className="setup-value">{character.tribeName ?? `Tribe ${character.tribeId}`}</span>
                </div>
                {isConfigured && (
                  <p className="success" style={{ marginTop: "0.25rem", fontSize: "0.75rem" }}>
                    Deployment registered
                  </p>
                )}
              </div>
            ) : (
              <p className="muted">No EVE Frontier character found for this wallet.</p>
            )}
          </div>
        )}

        {/* ── Step 3: SSU Selection ── */}
        {isConnected && character && (
          <div className="setup-section">
            <h4 className="setup-step-title">3. Enter SSU Address</h4>

            <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
              Paste the SSU assembly address (0x…) from the game client.
            </p>
            <input
              type="text"
              className="setup-input"
              placeholder="0x76f7de9009082a98dc3397a3cee51603d8eea35327f891bcfca50c9e4de1b24d"
              value={manualSsuId}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^0x[0-9a-fA-F]*$/.test(v) || v === "0") {
                  setManualSsuId(v);
                  setError(null);
                }
              }}
            />

            <button
              className="btn-primary setup-btn"
              style={{ marginTop: "0.75rem" }}
              disabled={!canConfirm || (needsNetworkNode && !networkNodeSkipped && !networkNodeInput.trim()) || (needsLocation && (!locationInput.trim() || !lpointP.trim() || !lpointL.trim()))}
              onClick={handleConfirm}
            >
              {busy ? status || "Setting up…" : needsLocation ? "Save Location & Continue" : needsNetworkNode ? "Continue" : "Confirm SSU"}
            </button>
          </div>
        )}

        {/* ── Step 4: Network Node (shown if none stored) ── */}
        {needsNetworkNode && !networkNodeSkipped && !busy && (
          <div className="setup-section">
            <h4 className="setup-step-title">4. Network Node</h4>
            <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
              Enter your Network Node assembly ID to track fuel status. You can find this in the game client by selecting your Network Node.
            </p>
            <input
              type="text"
              className="setup-input"
              placeholder="Network Node Assembly ID (0x…)"
              value={networkNodeInput}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "" || /^0x[0-9a-fA-F]*$/.test(v) || v === "0") {
                  setNetworkNodeInput(v);
                  setNetworkNodeStatus(null);
                }
              }}
            />
            {networkNodeStatus && (
              <p className={networkNodeStatus.type === "error" ? "error" : networkNodeStatus.type === "success" ? "success" : "muted"}
                style={{ fontSize: "0.75rem", marginTop: "0.25rem" }}>
                {networkNodeStatus.message}
              </p>
            )}
            <button
              className="btn-subtle"
              style={{ fontSize: "0.7rem", marginTop: "0.5rem", opacity: 0.7 }}
              onClick={() => {
                setNetworkNodeSkipped(true);
                setNeedsNetworkNode(false);
              }}
            >
              Skip — I\'ll add it later in Settings
            </button>
          </div>
        )}

        {/* ── Step 5: Location (shown only for first-time SSU setup) ── */}
        {needsLocation && !busy && (
          <div className="setup-section">
            <h4 className="setup-step-title">{needsNetworkNode && !networkNodeSkipped ? "5" : "4"}. SSU Location</h4>
            <p className="muted" style={{ fontSize: "0.75rem", marginBottom: "0.5rem" }}>
              This SSU has no location stored. Enter the solar system name and L-Point to register its position.
            </p>
            <input
              type="text"
              className="setup-input"
              placeholder="e.g. ERR-HSD"
              value={locationInput}
              onChange={(e) => setLocationInput(e.target.value)}
            />
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", alignItems: "center" }}>
              <span className="muted" style={{ fontSize: "0.75rem", whiteSpace: "nowrap" }}>L-Point:</span>
              <span className="lpoint-prefix">P</span>
              <input
                type="text"
                className="lpoint-input"
                placeholder="4"
                value={lpointP}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || /^\d{1,2}$/.test(v)) setLpointP(v);
                }}
                style={{ width: "2.5rem" }}
              />
              <span className="lpoint-prefix">L</span>
              <input
                type="text"
                className="lpoint-input"
                placeholder="3"
                value={lpointL}
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "" || /^\d{1,2}$/.test(v)) setLpointL(v);
                }}
                style={{ width: "2.5rem" }}
              />
            </div>
            <p className="muted" style={{ fontSize: "0.65rem", marginTop: "0.25rem", opacity: 0.6 }}>
              The P and L numbers are from the in-game location (e.g. P4L3). These are saved with your SSU and auto-fill when creating route links.
            </p>
          </div>
        )}

        {error && <p className="error" style={{ marginTop: "0.5rem", textAlign: "center" }}>{error}</p>}
      </div>
    </div>
  );
}
