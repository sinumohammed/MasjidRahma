import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getAuthStatus, loginAdmin, setupAdmin } from '../services/api';

const TOKEN_KEY = 'masjid_admin_token';
const USERNAME_KEY = 'masjid_admin_username';
const IS_ADMIN_KEY = 'masjid_is_admin';
const MEMBER_ID_KEY = 'masjid_member_id';

interface AuthContextValue {
  isAdmin: boolean;
  isLoggedIn: boolean;
  memberId: string | null;
  username: string | null;
  hasAdmin: boolean | null;
  login: (username: string, password: string) => Promise<void>;
  setupAccount: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [username, setUsername] = useState<string | null>(() => localStorage.getItem(USERNAME_KEY));
  const [isAdmin, setIsAdmin] = useState<boolean>(() => localStorage.getItem(IS_ADMIN_KEY) === 'true');
  const [memberId, setMemberId] = useState<string | null>(() => localStorage.getItem(MEMBER_ID_KEY));
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);

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

  const login = async (loginUsername: string, password: string) => {
    const result = await loginAdmin(loginUsername, password);
    applySession(result.token, result.username, result.isAdmin, result.memberId);
  };

  const setupAccount = async (newUsername: string, password: string) => {
    const result = await setupAdmin(newUsername, password);
    applySession(result.token, result.username, result.isAdmin, result.memberId);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    localStorage.removeItem(IS_ADMIN_KEY);
    localStorage.removeItem(MEMBER_ID_KEY);
    setToken(null);
    setUsername(null);
    setIsAdmin(false);
    setMemberId(null);
  };

  return (
    <AuthContext.Provider
      value={{ isAdmin, isLoggedIn: !!token, memberId, username, hasAdmin, login, setupAccount, logout }}
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
