import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  getAuthStatus,
  loginAdmin,
  setupAdmin,
  logActivity,
  refreshSession,
  SESSION_EXPIRED_EVENT,
} from '../services/api';

const TOKEN_KEY = 'masjid_admin_token';
const USERNAME_KEY = 'masjid_admin_username';
const IS_ADMIN_KEY = 'masjid_is_admin';
const MEMBER_ID_KEY = 'masjid_member_id';

function clearStoredSessionStorage(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USERNAME_KEY);
  localStorage.removeItem(IS_ADMIN_KEY);
  localStorage.removeItem(MEMBER_ID_KEY);
}

// Reads exp out of the JWT payload without verifying the signature (that's
// the server's job) - just enough to catch an obviously-dead token on the
// very first render, before any network round trip. A malformed token
// counts as expired rather than risking an infinite-loop of bad requests.
function isTokenExpired(token: string): boolean {
  try {
    const payloadB64 = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(payloadB64));
    return typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now();
  } catch {
    return true;
  }
}

// Runs once at module load, not inside a component - a useState initializer
// re-runs on StrictMode's dev-only double-mount, and by the second run the
// storage this already cleared would make it look like there was nothing to
// clear, silently skipping the SESSION_EXPIRED_EVENT dispatch below.
const expiredTokenOnLoad = (() => {
  const storedToken = localStorage.getItem(TOKEN_KEY);
  const dead = !!storedToken && isTokenExpired(storedToken);
  if (dead) clearStoredSessionStorage();
  return dead;
})();

interface AuthContextValue {
  isAdmin: boolean;
  isLoggedIn: boolean;
  memberId: string | null;
  username: string | null;
  hasAdmin: boolean | null;
  login: (username: string, password: string) => Promise<void>;
  setupAccount: (username: string, password: string) => Promise<void>;
  logout: () => void;
  checkSessionExpiry: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  // expiredTokenOnLoad already cleared localStorage (at module load, before
  // this component ever ran) if the stored token was dead, so these
  // initializers naturally come up empty/false - admin-gated views render as
  // logged-out on the very first paint instead of waiting on a round trip.
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [username, setUsername] = useState<string | null>(() => localStorage.getItem(USERNAME_KEY));
  const [isAdmin, setIsAdmin] = useState<boolean>(() => localStorage.getItem(IS_ADMIN_KEY) === 'true');
  const [memberId, setMemberId] = useState<string | null>(() => localStorage.getItem(MEMBER_ID_KEY));
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);

  // Deferred to an effect (can't dispatch a DOM event during render) so the
  // login modal still pops for a token that expired while the tab was
  // closed, same as one that expires mid-session.
  useEffect(() => {
    if (expiredTokenOnLoad) window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
  }, []);

  useEffect(() => {
    getAuthStatus()
      .then((status) => setHasAdmin(status.hasAdmin))
      .catch(() => setHasAdmin(null));
  }, []);

  const applySession = (
    newToken: string,
    newUsername: string,
    newIsAdmin: boolean,
    newMemberId: string | null
  ) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USERNAME_KEY, newUsername);
    localStorage.setItem(IS_ADMIN_KEY, String(newIsAdmin));
    if (newMemberId) {
      localStorage.setItem(MEMBER_ID_KEY, newMemberId);
    } else {
      localStorage.removeItem(MEMBER_ID_KEY);
    }
    setToken(newToken);
    setUsername(newUsername);
    setIsAdmin(newIsAdmin);
    setMemberId(newMemberId);
    if (newIsAdmin) setHasAdmin(true);
  };

  // Sliding session: revalidate + extend the token once per app load. A
  // visit at least once a month keeps renewing the 30-day window; an
  // untouched token still dies after 30 days. A failed refresh is already handled by
  // the SESSION_EXPIRED_EVENT listener below (apiFetch clears storage and
  // fires it on the 401), so this just swallows the rejection - no need to
  // react to it twice.
  useEffect(() => {
    if (!localStorage.getItem(TOKEN_KEY)) return;
    refreshSession()
      .then((result) => applySession(result.token, result.username, result.isAdmin, result.memberId))
      .catch(() => {});
  }, []);

  const login = async (loginUsername: string, password: string) => {
    const result = await loginAdmin(loginUsername, password);
    applySession(result.token, result.username, result.isAdmin, result.memberId);
    logActivity('login');
  };

  const setupAccount = async (newUsername: string, password: string) => {
    const result = await setupAdmin(newUsername, password);
    applySession(result.token, result.username, result.isAdmin, result.memberId);
    logActivity('login');
  };

  const clearSessionState = () => {
    clearStoredSessionStorage();
    setToken(null);
    setUsername(null);
    setIsAdmin(false);
    setMemberId(null);
  };

  const logout = () => {
    // Must fire while the token is still in localStorage - authHeaders()
    // reads it synchronously when this call builds its fetch options, before
    // the request actually goes out, so clearing storage right after is safe.
    logActivity('logout');
    clearSessionState();
  };

  // apiFetch already clears localStorage itself (before AuthProvider could
  // possibly be listening), so this just syncs React state to match and
  // skips logActivity('logout') - the token is already dead, so that call
  // would just 401 again.
  useEffect(() => {
    const onSessionExpired = () => clearSessionState();
    window.addEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, onSessionExpired);
  }, []);

  // The mount-time expiry check only catches a token that was already dead
  // when the tab opened. Since most GET endpoints are public (see
  // CLAUDE.md), just sitting on a page like Transactions/Banks/Members never
  // calls a protected endpoint and never trips the 401 interceptor, so
  // isAdmin/isLoggedIn would otherwise stay stuck "true" indefinitely past
  // expiry - or past storage being wiped out from under a still-running tab
  // (e.g. devtools "Clear site data"), which leaves no token to even decode.
  // Treat "React thinks we're logged in but storage now disagrees" as
  // equally dead as an expired token, not just a no-op.
  //
  // Deliberately does NOT dispatch SESSION_EXPIRED_EVENT - App.tsx calls
  // this synchronously before its own setActiveKey in every nav handler, so
  // dispatching here would fire App's listener with the *old* activeKey
  // (the click hasn't re-rendered yet) and could pop the login modal over a
  // view that doesn't need one, e.g. Yearly Schedule. Clearing state here is
  // enough - App's own [isAdmin, isLoggedIn, activeKey] effect reacts to the
  // (batched) state change and already knows exactly which views require a
  // login prompt.
  const isSessionDead = () => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    return storedToken ? isTokenExpired(storedToken) : !!token;
  };

  const checkSessionExpiry = () => {
    if (isSessionDead()) clearSessionState();
  };

  // Focus/visibilitychange has no accompanying activeKey change to react
  // to, so this is the one place a bare SESSION_EXPIRED_EVENT dispatch is
  // still correct - App's listener reads whatever page is *currently*
  // showing (nothing is mid-navigation) and decides from there.
  useEffect(() => {
    const recheckAndNotify = () => {
      if (isSessionDead()) {
        clearSessionState();
        window.dispatchEvent(new Event(SESSION_EXPIRED_EVENT));
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') recheckAndNotify();
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', recheckAndNotify);
    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', recheckAndNotify);
    };
  }, [token]);

  return (
    <AuthContext.Provider
      value={{
        isAdmin,
        isLoggedIn: !!token,
        memberId,
        username,
        hasAdmin,
        login,
        setupAccount,
        logout,
        checkSessionExpiry,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
