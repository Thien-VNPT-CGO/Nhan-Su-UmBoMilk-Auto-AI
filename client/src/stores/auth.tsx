import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { api } from '../api/client';

export interface User {
  id: string;
  username: string;
  fullName: string;
  role: 'ADMIN' | 'HR' | 'VIEWER';
  twoFactorEnabled?: boolean;
  branchScope?: string[] | null;
  allowedTabs?: string[] | null;
}

export interface LoginResult {
  needsTwoFactor?: boolean;
  twoFactorToken?: string;
  user?: User;
}

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<LoginResult>;
  verifyTwoFactor: (token: string, code: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.get<{ user: User }>('/auth/me');
      setUser(data.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(async (username: string, password: string) => {
    const data = await api.post<LoginResult>('/auth/login', { username, password });
    if (data.needsTwoFactor || !data.user) return data;
    setUser(data.user);
    return data;
  }, []);

  const verifyTwoFactor = useCallback(async (token: string, code: string) => {
    const data = await api.post<{ user: User }>('/auth/two-factor/verify', { token, code });
    setUser(data.user);
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, verifyTwoFactor, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}