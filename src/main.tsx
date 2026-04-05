// Force Eve Vault extension to use the configured tenant.
// Must run before the extension's injected.js hydrates its Zustand store.
import { EVE_TENANT } from "./config";
try {
  const key = "evevault:tenant";
  const cur = localStorage.getItem(key);
  if (!cur || !cur.includes(`"${EVE_TENANT}"`)) {
    localStorage.setItem(
      key,
      JSON.stringify({ state: { tenantId: EVE_TENANT, devMode: false }, version: 0 }),
    );
  }
} catch { /* no localStorage in SSR */ }

// Normalise URL params: the game client sends snake_case (?item_id=)
// but @evefrontier/dapp-kit SmartObjectProvider expects camelCase (?itemId=).
// Rewrite before React mounts so SmartObjectProvider picks up the value.
try {
  const params = new URLSearchParams(window.location.search);
  if (params.has("item_id") && !params.has("itemId")) {
    params.set("itemId", params.get("item_id")!);
    params.delete("item_id");
    const newUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
    window.history.replaceState(null, "", newUrl);
  }
} catch { /* SSR guard */ }

import React from "react";
import ReactDOM from "react-dom/client";
import "./main.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App.tsx";
import { OverlayPage } from "./pages/OverlayPage.tsx";
import {
  VaultProvider,
  SmartObjectProvider,
  NotificationProvider,
} from "@evefrontier/dapp-kit";
import { createDAppKit, DAppKitProvider } from "@mysten/dapp-kit-react";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Theme } from "@radix-ui/themes";

// ---------------------------------------------------------------------------
// Error Boundary — prevents a grey screen if any child throws during render
// ---------------------------------------------------------------------------
class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; info: React.ErrorInfo | null }
> {
  state: { error: Error | null; info: React.ErrorInfo | null } = { error: null, info: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    this.setState({ info });
    console.error("[ErrorBoundary]", error, info.componentStack);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: "#f88", fontFamily: "monospace" }}>
          <h2>Something went wrong</h2>
          <pre style={{ whiteSpace: "pre-wrap" }}>
            {this.state.error.message}
          </pre>
          {this.state.error.stack && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: "pointer", color: "#aaa" }}>Stack trace</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.75rem", color: "#ccc", marginTop: 8 }}>
                {this.state.error.stack}
              </pre>
            </details>
          )}
          {this.state.info?.componentStack && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ cursor: "pointer", color: "#aaa" }}>Component stack</summary>
              <pre style={{ whiteSpace: "pre-wrap", fontSize: "0.75rem", color: "#ccc", marginTop: 8 }}>
                {this.state.info.componentStack}
              </pre>
            </details>
          )}
          <button onClick={() => location.reload()} style={{ marginTop: 16 }}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const GRPC_URLS = {
  testnet: "https://fullnode.testnet.sui.io:443",
  devnet: "https://fullnode.devnet.sui.io:443",
} as const;

type SupportedNetwork = keyof typeof GRPC_URLS;
const SUPPORTED_NETWORKS = Object.keys(GRPC_URLS) as SupportedNetwork[];

const dAppKit = createDAppKit({
  networks: SUPPORTED_NETWORKS,
  createClient(network) {
    return new SuiGrpcClient({
      network,
      baseUrl: GRPC_URLS[network as keyof typeof GRPC_URLS],
    });
  },
  // Disable the built-in Slush web-wallet registration so the browser
  // extension is used directly (the web-wallet opens a tab but fails to
  // complete the handshake on localhost).
  slushWalletConfig: null,
});

const queryClient = new QueryClient();

/** Detect if we're rendering the standalone overlay page. */
const isOverlayRoute = window.location.pathname === "/overlay";
const overlayParams = isOverlayRoute
  ? new URLSearchParams(window.location.search)
  : null;

/** Provider stack: QueryClient → DAppKit (Sui wallet) → Vault → SmartObject → Notification. */
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
    <Theme appearance="dark">
      <QueryClientProvider client={queryClient}>
        <DAppKitProvider dAppKit={dAppKit}>
          <VaultProvider>
            <SmartObjectProvider>
              <NotificationProvider>
                {isOverlayRoute ? (
                  <OverlayPage
                    ssuId={overlayParams?.get("ssuId") ?? ""}
                    tribeId={overlayParams?.get("tribeId") ?? ""}
                  />
                ) : (
                  <App />
                )}
              </NotificationProvider>
            </SmartObjectProvider>
          </VaultProvider>
        </DAppKitProvider>
      </QueryClientProvider>
    </Theme>
    </ErrorBoundary>
  </React.StrictMode>,
);
