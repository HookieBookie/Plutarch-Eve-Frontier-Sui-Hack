import { useState, useCallback, useMemo } from "react";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { Toolbar } from "./components/Toolbar";
import { PriceTicker } from "./components/PriceTicker";
import { HomePage } from "./pages/HomePage";
import { ExchangePage } from "./pages/ExchangePage";
import { TribePage } from "./pages/TribePage";
import { MarketPage } from "./pages/MarketPage";
import { AdminPage } from "./pages/AdminPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TerritoryPage } from "./pages/TerritoryPage";
import { SetupPage } from "./pages/SetupPage";
import { GoalProvider } from "./context/GoalContext";
import { ContractProvider } from "./context/ContractContext";
import { DeploymentProvider } from "./context/DeploymentContext";
import { useCharacter } from "./hooks/useCharacter";
import { TRIBE_ID } from "./config";

type Page = "home" | "exchange" | "tribe" | "market" | "admin" | "network" | "settings";

/** Info about a remote SSU the user is browsing via a data link. */
export interface RemoteBrowse {
  ssuId: string;
  label: string;
  allowedCategories: string[];  // ["goals", "market", "inventory"]
  initialPage: Page;
  isOwned?: boolean;  // true when user owns the remote SSU
  locationGranted?: boolean;  // true when user has location access to the remote SSU
}

function App() {
  const [page, setPage] = useState<Page>("home");
  const [ssuReady, setSsuReady] = useState(false);
  const [ssuId, setSsuId] = useState("");
  const [ssuOwner, setSsuOwner] = useState("");
  const [ssuTribeId, setSsuTribeId] = useState("");
  const account = useCurrentAccount();
  const { data: character } = useCharacter(account?.address);

  // ── Remote SSU browsing (via data links) ──
  const [remoteBrowse, setRemoteBrowse] = useState<RemoteBrowse | null>(null);

  const handleBrowseRemote = useCallback((info: RemoteBrowse) => {
    setRemoteBrowse(info);
    setPage(info.initialPage);
  }, []);

  const handleDisconnectRemote = useCallback(() => {
    setRemoteBrowse(null);
    setPage("network");
  }, []);

  // Use the character's on-chain tribe ID if available, otherwise fall back to env
  const tribeId = String(character?.tribeId ?? TRIBE_ID);

  // Determine if current user is the SSU owner
  const localIsOwner = !!account?.address && !!ssuOwner && account.address.toLowerCase() === ssuOwner.toLowerCase();
  // When remote-browsing, ownership refers to the remote SSU, not the local one
  const isOwner = remoteBrowse ? !!remoteBrowse.isOwned : localIsOwner;

  // Determine if current user is a member of the SSU's tribe
  const isTribeMember = !!ssuTribeId && tribeId === ssuTribeId;

  // If a non-owner navigates to owner-only pages, redirect to home
  // (admin page handles its own auth internally)
  const effectivePage = (!localIsOwner && page === "settings") ? "home" : page;

  // When browsing remotely, restrict which pages are accessible
  const remoteAllowed = remoteBrowse
    ? (() => {
        const s = new Set<Page>(remoteBrowse.allowedCategories.map((c) => {
          if (c === "goals") return "home" as Page;
          if (c === "market" || c === "inventory") return "market" as Page;
          return "exchange" as Page;
        }));
        s.add("tribe");  // Corporation page always accessible during remote browse
        s.add("exchange");  // Exchange page always accessible during remote browse
        return s;
      })()
    : null;

  // Pages hidden from the toolbar during remote browsing
  const hiddenPages = useMemo(() => {
    if (!remoteBrowse) return undefined;
    const allPages: Page[] = ["home", "exchange", "tribe", "market", "network", "settings"];
    const allowed = new Set<Page>(remoteBrowse.allowedCategories.map((c) => {
      if (c === "goals") return "home" as Page;
      if (c === "market" || c === "inventory") return "market" as Page;
      return "exchange" as Page;
    }));
    const hidden = new Set<Page>();
    for (const p of allPages) {
      // Always hide network and settings during remote browse
      if (p === "network" || p === "settings") { hidden.add(p); continue; }
      // Tribe (Corporation) and Exchange are always visible during remote browse
      if (p === "tribe" || p === "exchange") continue;
      if (!allowed.has(p)) hidden.add(p);
    }
    return hidden;
  }, [remoteBrowse]);

  // Active SSU for data context — remote overrides local
  const activeSsuId = remoteBrowse?.ssuId ?? ssuId;

  // SSU not yet initialised — show setup page
  if (!ssuReady) {
    return (
      <DeploymentProvider tribeId={tribeId}>
        <SetupPage
          onComplete={(id, owner, ownerTribeId) => {
            setSsuId(id);
            setSsuOwner(owner);
            setSsuTribeId(ownerTribeId);
            setSsuReady(true);
          }}
        />
      </DeploymentProvider>
    );
  }

  return (
    <DeploymentProvider tribeId={tribeId}>
      <GoalProvider tribeId={tribeId} ssuId={activeSsuId}>
      <ContractProvider tribeId={tribeId} ssuId={activeSsuId}>
        <div className="app-shell">
          <Toolbar
            activePage={effectivePage}
            onNavigate={(p) => {
              // When remote-browsing, only allow accessible pages (hidden tabs enforce this too)
              if (remoteAllowed && !remoteAllowed.has(p)) return;
              setPage(p);
            }}
            isOwner={localIsOwner}
            hiddenPages={hiddenPages}
          />

          {/* Remote browsing banner */}
          {remoteBrowse && (
            <div className="remote-banner">
              <span className="remote-banner-label">
                Viewing: <strong>{remoteBrowse.label}</strong>
              </span>
              <button className="remote-banner-disconnect" onClick={handleDisconnectRemote}>
                ✕ Disconnect
              </button>
            </div>
          )}

          <main className="app-content">
            {effectivePage === "home" && (
              <HomePage
                hiddenCategories={remoteBrowse
                  ? [
                      ...["goals", "inventory"].filter((c) => !remoteBrowse.allowedCategories.includes(c)),
                      ...(!remoteBrowse.isOwned && !remoteBrowse.locationGranted ? ["fuel"] : []),
                    ]
                  : undefined
                }
              />
            )}
            {effectivePage === "exchange" && <ExchangePage />}
            {effectivePage === "tribe" && <TribePage isOwner={isOwner} isTribeMember={isTribeMember} />}
            {effectivePage === "market" && <MarketPage ssuId={activeSsuId} ssuTribeId={ssuTribeId} />}
            {effectivePage === "network" && (
              <TerritoryPage onBrowseRemote={handleBrowseRemote} />
            )}
            {effectivePage === "settings" && <SettingsPage />}
            {effectivePage === "admin" && <AdminPage onNavigateHome={() => setPage("home")} />}
          </main>
          <PriceTicker />

          {/* Pop-out overlay button — opens the overlay in a compact window */}
          <button
            className="overlay-popout-btn"
            title="Open mission overlay (for use while in-game)"
            onClick={() => {
              const params = new URLSearchParams({ ssuId: activeSsuId, tribeId });
              window.open(`/overlay?${params.toString()}`, "plutarch-overlay", "width=320,height=480,resizable=yes,scrollbars=no");
            }}
          >
            ⊞ Overlay
          </button>
        </div>
      </ContractProvider>
      </GoalProvider>
    </DeploymentProvider>
  );
}

export default App;
