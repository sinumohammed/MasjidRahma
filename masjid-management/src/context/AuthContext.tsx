import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { getAuthStatus, loginAdmin, setupAdmin } from '../services/api';

const TOKEN_KEY = 'masjid_admin_token';
const USERNAME_KEY = 'masjid_admin_username';

interface AuthContextValue {
  isAdmin: boolean;
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
  const [hasAdmin, setHasAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    getAuthStatus()
      .then((status) => setHasAdmin(status.hasAdmin))
      .catch(() => setHasAdmin(null));
  }, []);

  const applySession = (newToken: string, newUsername: string) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    localStorage.setItem(USERNAME_KEY, newUsername);
    setToken(newToken);
    setUsername(newUsername);
    setHasAdmin(true);
  };

  const login = async (loginUsername: string, password: string) => {
    const result = await loginAdmin(loginUsername, password);
    applySession(result.token, result.username);
  };

  const setupAccount = async (newUsername: string, password: string) => {
    const result = await setupAdmin(newUsername, password);
    applySession(result.token, result.username);
  };

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USERNAME_KEY);
    setToken(null);
    setUsername(null);
  };

  return (
    <AuthContext.Provider
      value={{ isAdmin: !!token, username, hasAdmin, login, setupAccount, logout }}
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
