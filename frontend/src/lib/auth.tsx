import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { getMe, signOut as apiSignOut, SIGNED_OUT_EVENT } from "./api";
import { rememberJob } from "./server";
import type { AuthUser } from "./types";

interface AuthState {
  user: AuthUser | null;
  /** false until the first /api/auth/me answer. */
  ready: boolean;
  /** No accounts exist yet: the first administrator signs up from the console link. */
  setupRequired: boolean;
  publicSamples: boolean;
  refresh: () => Promise<void>;
  /** Called after sign-in or sign-up with the account the server returned. */
  signedIn: (user: AuthUser) => void;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

// Other tabs of the same site follow sign-in and sign-out.
const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("glioma-auth") : null;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const [setupRequired, setSetupRequired] = useState(false);
  const [publicSamples, setPublicSamples] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const me = await getMe();
      setUser(me.user);
      setSetupRequired(me.setup_required);
      setPublicSamples(me.public_samples);
    } catch {
      /* server unreachable: keep what we had */
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const onSignedOut = () => void refresh();
    const onMessage = () => void refresh();
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    channel?.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
      channel?.removeEventListener("message", onMessage);
    };
  }, [refresh]);

  const signedIn = useCallback((next: AuthUser) => {
    setUser(next);
    setSetupRequired(false);
    setReady(true);
    channel?.postMessage("changed");
  }, []);

  const signOut = useCallback(async () => {
    try {
      await apiSignOut();
    } finally {
      rememberJob(null); // the next person on this device should not see the last result link
      setUser(null);
      channel?.postMessage("changed");
    }
  }, []);

  const value = useMemo(
    () => ({ user, ready, setupRequired, publicSamples, refresh, signedIn, signOut }),
    [user, ready, setupRequired, publicSamples, refresh, signedIn, signOut],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth outside AuthProvider");
  return value;
}

/** Only same-site paths, so a crafted ?next= cannot send people to another website after signing in. */
export function safeNext(next: string | null | undefined, fallback = "/"): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  if (/^\/(signin|signup)\b/.test(next)) return fallback;
  return next;
}

export function signInPath(location: { pathname: string; search: string; hash?: string }): string {
  return `/signin?next=${encodeURIComponent(location.pathname + location.search)}`;
}

function Checking() {
  return (
    <main className="auth-page">
      <div className="spinner" role="status" aria-label="Checking your sign-in" />
    </main>
  );
}

export function RequireAuth({ children, admin = false }: { children: ReactNode; admin?: boolean }) {
  const { user, ready } = useAuth();
  const location = useLocation();
  if (!ready) return <Checking />;
  if (!user) return <Navigate to={signInPath(location)} replace />;
  if (admin && user.role !== "admin") return <Navigate to="/account" replace />;
  return <>{children}</>;
}

export function initials(user: Pick<AuthUser, "display_name" | "username">): string {
  const words = (user.display_name || user.username).replace(/^(dr|prof)\.?\s+/i, "").split(/[\s._-]+/).filter(Boolean);
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? "?").slice(0, 2);
  return letters.toUpperCase();
}
