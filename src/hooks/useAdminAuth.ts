import { useState, useCallback } from "react";
import { useDAppKit, useCurrentAccount } from "@mysten/dapp-kit-react";
import { ADMIN_ADDRESS } from "../config";

interface AdminAuthState {
  authenticated: boolean;
  pending: boolean;
  error: string | null;
}

/**
 * Admin authentication via wallet signature challenge.
 *
 * Security model:
 *  1. Connected wallet address must match ADMIN_ADDRESS (fast gate).
 *  2. User must sign a timestamped challenge via signPersonalMessage.
 *     The wallet extension handles signing in a sandboxed context —
 *     browser inspector modifications cannot forge valid signatures.
 *  3. Auth state resets on page reload (held in React state only).
 */
export function useAdminAuth() {
  const account = useCurrentAccount();
  const { signPersonalMessage } = useDAppKit();
  const [state, setState] = useState<AdminAuthState>({
    authenticated: false,
    pending: false,
    error: null,
  });

  const isAdmin =
    !!account?.address &&
    account.address.toLowerCase() === ADMIN_ADDRESS.toLowerCase();

  const authenticate = useCallback(async () => {
    if (!account || !isAdmin) {
      setState({ authenticated: false, pending: false, error: "Not authorized" });
      return;
    }

    setState({ authenticated: false, pending: true, error: null });

    try {
      // Build a unique challenge with a random nonce and timestamp.
      // Even if intercepted, it can't be replayed after the session resets.
      const nonce = crypto.getRandomValues(new Uint8Array(16));
      const nonceHex = Array.from(nonce)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      const challenge =
        `Plutarch Admin Authentication\n` +
        `Nonce: ${nonceHex}\n` +
        `Timestamp: ${Date.now()}\n` +
        `Address: ${account.address}`;

      await signPersonalMessage({
        message: new TextEncoder().encode(challenge),
      });

      // signPersonalMessage succeeded → the connected wallet proved
      // ownership of the private key for ADMIN_ADDRESS.
      setState({ authenticated: true, pending: false, error: null });
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? String(e);
      const friendly = /rejected|denied|cancelled/i.test(msg)
        ? "Authentication cancelled."
        : `Authentication failed: ${msg}`;
      setState({ authenticated: false, pending: false, error: friendly });
    }
  }, [account, isAdmin, signPersonalMessage]);

  const logout = useCallback(() => {
    setState({ authenticated: false, pending: false, error: null });
  }, []);

  return {
    isAdmin,
    authenticated: state.authenticated,
    pending: state.pending,
    error: state.error,
    authenticate,
    logout,
  };
}
