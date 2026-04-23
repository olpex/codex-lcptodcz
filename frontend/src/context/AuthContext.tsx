import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { apiRequest } from "../api/client";
import type { TokenPair, User } from "../types/api";

type AuthContextType = {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
};

const STORAGE_KEY = "suptc_auth";
const AuthContext = createContext<AuthContextType | null>(null);

type PersistedAuth = {
  accessToken: string;
  refreshToken: string;
};

function readStoredTokens(): PersistedAuth | null {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PersistedAuth;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const persistTokens = (tokens: PersistedAuth | null) => {
    if (!tokens) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  };

  const applyTokenPair = (pair: TokenPair) => {
    setAccessToken(pair.access_token);
    setRefreshToken(pair.refresh_token);
    persistTokens({ accessToken: pair.access_token, refreshToken: pair.refresh_token });
  };

  const fetchMe = async (token: string) => {
    const me = await apiRequest<User>("/auth/me", { method: "GET", token });
    setUser(me);
  };

  const refresh = async (token: string): Promise<string> => {
    const pair = await apiRequest<TokenPair>("/auth/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: token })
    });
    applyTokenPair(pair);
    await fetchMe(pair.access_token);
    return pair.access_token;
  };

  useEffect(() => {
    const bootstrap = async () => {
      const stored = readStoredTokens();
      if (!stored) {
        setIsLoading(false);
        return;
      }
      setAccessToken(stored.accessToken);
      setRefreshToken(stored.refreshToken);
      try {
        await fetchMe(stored.accessToken);
      } catch {
        try {
          await refresh(stored.refreshToken);
        } catch {
          persistTokens(null);
          setAccessToken(null);
          setRefreshToken(null);
          setUser(null);
        }
      } finally {
        setIsLoading(false);
      }
    };
    bootstrap();
  }, []);

  const login = async (username: string, password: string) => {
    const pair = await apiRequest<TokenPair>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
    applyTokenPair(pair);
    await fetchMe(pair.access_token);
  };

  const logout = async () => {
    if (refreshToken && accessToken) {
      try {
        await apiRequest<void>("/auth/logout", {
          method: "POST",
          token: accessToken,
          body: JSON.stringify({ refresh_token: refreshToken })
        });
      } catch {
        // ignore logout failures
      }
    }
    persistTokens(null);
    setUser(null);
    setAccessToken(null);
    setRefreshToken(null);
  };

  const request = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    if (!accessToken) {
      throw new Error("Потрібна авторизація");
    }
    try {
      return await apiRequest<T>(path, { ...init, token: accessToken });
    } catch (error) {
      const err = error as Error & { status?: number };
      if (err.status === 401 && refreshToken) {
        const nextAccess = await refresh(refreshToken);
        return apiRequest<T>(path, { ...init, token: nextAccess });
      }
      throw err;
    }
  };

  const value = useMemo(
    () => ({ user, accessToken, isLoading, login, logout, request }),
    [user, accessToken, isLoading]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth має використовуватись всередині AuthProvider");
  }
  return ctx;
}

