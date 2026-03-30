import { useState, useRef, useEffect, useCallback } from "react";
import { abbreviateAddress, useConnection } from "@evefrontier/dapp-kit";
import { useWallets, useDAppKit } from "@mysten/dapp-kit-react";
import { useCharacter } from "../hooks/useCharacter";
import { ADMIN_ADDRESS } from "../config";

type Page = "home" | "exchange" | "tribe" | "market" | "admin" | "network" | "settings";

interface ToolbarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
  isOwner: boolean;
  /** Pages hidden during remote browse (plus territory is always hidden when set) */
  hiddenPages?: Set<Page>;
}

/** SVG profile silhouette icon */
function ProfileIcon({ connected }: { connected: boolean }) {
  return (
    <svg viewBox="0 0 40 40" width="32" height="32" style={{ display: "block" }}>
      <circle cx="20" cy="20" r="19" fill={connected ? "#1a1a1a" : "#222"} stroke={connected ? "#FF6600" : "#555"} strokeWidth="1.5" />
      <circle cx="20" cy="15" r="6" fill={connected ? "#FF6600" : "#555"} />
      <path d="M8 34 Q8 24 20 24 Q32 24 32 34" fill={connected ? "#FF6600" : "#555"} />
    </svg>
  );
}

export function Toolbar({ activePage, onNavigate, isOwner, hiddenPages }: ToolbarProps) {
  const { currentAccount: account, isConnected, hasEveVault, handleConnect, handleDisconnect } = useConnection();
  const wallets = useWallets();
  const { connectWallet } = useDAppKit();
  const [showPicker, setShowPicker] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const profileRef = useRef<HTMLDivElement>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);

  const { data: character } = useCharacter(account?.address);

  // Auto-connect when EVE in-game wallet is detected and no wallet is connected
  const autoConnectAttempted = useRef(false);
  useEffect(() => {
    if (isConnected || autoConnectAttempted.current) return;
    if (hasEveVault) {
      autoConnectAttempted.current = true;
      handleConnect();
    }
  }, [hasEveVault, isConnected, handleConnect]);

  // Close profile/picker on outside click
  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false);
        setShowPicker(false);
      }
    }
    if (profileOpen || showPicker) document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [profileOpen, showPicker]);

  const handleProfileEnter = useCallback(() => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setProfileOpen(true);
  }, []);

  const handleProfileLeave = useCallback(() => {
    hoverTimer.current = setTimeout(() => setProfileOpen(false), 250);
  }, []);

  const isAdminWallet =
    !!account?.address &&
    account.address.toLowerCase() === ADMIN_ADDRESS.toLowerCase();

  return (
    <nav className="toolbar">
      <div
        className={`toolbar-brand${isAdminWallet ? " toolbar-brand-clickable" : ""}`}
        ref={profileRef}
        onMouseEnter={handleProfileEnter}
        onMouseLeave={handleProfileLeave}
        onClick={isAdminWallet ? () => onNavigate("admin") : undefined}
        title={isAdminWallet ? "Plutarch Admin" : undefined}
      >
        PLUTARCH

        {profileOpen && (
          <div className="profile-menu brand-profile-menu">
            {isConnected && account ? (
              <>
                <div className="profile-menu-header">
                  <ProfileIcon connected />
                  <div className="profile-menu-identity">
                    <span className="profile-menu-name">
                      {character?.name ?? "Loading…"}
                    </span>
                    <span className="profile-menu-tribe">
                      {character
                        ? character.tribeName ?? `Tribe ${character.tribeId}`
                        : ""}
                    </span>
                  </div>
                </div>
                <div className="profile-menu-row">
                  <span className="profile-menu-label">Wallet</span>
                  <span className="profile-menu-value mono-sm">
                    {abbreviateAddress(account.address)}
                  </span>
                </div>
                <button
                  className="profile-menu-disconnect"
                  onClick={() => { handleDisconnect(); setProfileOpen(false); }}
                >
                  Disconnect Wallet
                </button>
              </>
            ) : (
              <div className="profile-menu-connect" ref={pickerRef}>
                <div className="profile-menu-header">
                  <ProfileIcon connected={false} />
                  <span className="profile-menu-name muted">Not connected</span>
                </div>
                {hasEveVault ? (
                  <button
                    className="btn-primary profile-menu-connect-btn"
                    onClick={() => { handleConnect(); setProfileOpen(false); }}
                  >
                    Connect Eve Vault
                  </button>
                ) : showPicker ? (
                  <div className="profile-menu-wallets">
                    {wallets.length === 0 ? (
                      <div className="wallet-picker-empty">
                        No Sui wallets detected.
                        <br />
                        Install <a href="https://slush.app" target="_blank" rel="noopener noreferrer">Slush</a> or use the Eve Vault in-game client.
                      </div>
                    ) : (
                      wallets.map((w) => (
                        <button
                          key={w.name}
                          className="wallet-picker-item"
                          onClick={async () => {
                            setConnectError(null);
                            setShowPicker(false);
                            setProfileOpen(false);
                            try {
                              await connectWallet({ wallet: w });
                            } catch (err) {
                              setConnectError((err as Error).message);
                            }
                          }}
                        >
                          {w.icon && (
                            <img
                              src={`data:image/svg+xml;utf8,${encodeURIComponent(w.icon)}`}
                              alt=""
                              className="wallet-icon"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          )}
                          <span>{w.name}</span>
                        </button>
                      ))
                    )}
                  </div>
                ) : (
                  <button
                    className="btn-primary profile-menu-connect-btn"
                    onClick={() => setShowPicker(true)}
                  >
                    Connect Wallet
                  </button>
                )}
                {connectError && (
                  <div className="wallet-picker-error">{connectError}</div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <div className="toolbar-tabs">
        {!(hiddenPages?.has("home")) && (
          <button
            className={`toolbar-tab ${activePage === "home" ? "active" : ""}`}
            onClick={() => onNavigate("home")}
          >
            Home
          </button>
        )}
        {!(hiddenPages?.has("exchange")) && (
          <button
            className={`toolbar-tab ${activePage === "exchange" ? "active" : ""}`}
            onClick={() => onNavigate("exchange")}
          >
            Exchange
          </button>
        )}
        {!(hiddenPages?.has("tribe")) && (
          <button
            className={`toolbar-tab ${activePage === "tribe" ? "active" : ""}`}
            onClick={() => onNavigate("tribe")}
          >
            Corporation
          </button>
        )}
        {!(hiddenPages?.has("market")) && (
          <button
            className={`toolbar-tab ${activePage === "market" ? "active" : ""}`}
            onClick={() => onNavigate("market")}
          >
            Market
          </button>
        )}
        {!(hiddenPages?.has("network")) && (
          <button
            className={`toolbar-tab ${activePage === "network" ? "active" : ""}`}
            onClick={() => onNavigate("network")}
          >
            Network
          </button>
        )}
        {isOwner && !(hiddenPages?.has("settings")) && (
          <button
            className={`toolbar-tab ${activePage === "settings" ? "active" : ""}`}
            onClick={() => onNavigate("settings")}
          >
            Settings
          </button>
        )}
      </div>

    </nav>
  );
}
