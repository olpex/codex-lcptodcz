import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  const accessTokenRef = useRef<string | null>(null);
  const refreshTokenRef = useRef<string | null>(null);
  const refreshPromiseRef = useRef<Promise<string> | null>(null);

  const persistTokens = (tokens: PersistedAuth | null) => {
    if (!tokens) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
  };

  const applyTokenPair = (pair: TokenPair) => {
    accessTokenRef.current = pair.access_token;
    refreshTokenRef.current = pair.refresh_token;
    setAccessToken(pair.access_token);
    setRefreshToken(pair.refresh_token);
    persistTokens({ accessToken: pair.access_token, refreshToken: pair.refresh_token });
  };

  const clearAuth = () => {
    accessTokenRef.current = null;
    refreshTokenRef.current = null;
    persistTokens(null);
    setUser(null);
    setAccessToken(null);
    setRefreshToken(null);
  };

  const fetchMe = async (token: string) => {
    const me = await apiRequest<User>("/auth/me", { method: "GET", token });
    setUser(me);
  };

  const refresh = async (token: string): Promise<string> => {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current;
    }

    const refreshPromise = (async () => {
      try {
        const pair = await apiRequest<TokenPair>("/auth/refresh", {
          method: "POST",
          body: JSON.stringify({ refresh_token: token })
        });
        applyTokenPair(pair);
        await fetchMe(pair.access_token);
        return pair.access_token;
      } catch (error) {
        clearAuth();
        const sessionError = new Error("Сесія завершилась. Увійдіть повторно.") as Error & { status?: number };
        sessionError.status = (error as Error & { status?: number }).status ?? 401;
        throw sessionError;
      } finally {
        refreshPromiseRef.current = null;
      }
    })();

    refreshPromiseRef.current = refreshPromise;
    return refreshPromise;
  };

  useEffect(() => {
    const bootstrap = async () => {
      const stored = readStoredTokens();
      if (!stored) {
        setIsLoading(false);
        return;
      }
      accessTokenRef.current = stored.accessToken;
      refreshTokenRef.current = stored.refreshToken;
      setAccessToken(stored.accessToken);
      setRefreshToken(stored.refreshToken);
      try {
        await fetchMe(stored.accessToken);
      } catch {
        try {
          await refresh(stored.refreshToken);
        } catch {
          clearAuth();
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
    const currentRefreshToken = refreshTokenRef.current;
    const currentAccessToken = accessTokenRef.current;
    if (currentRefreshToken && currentAccessToken) {
      try {
        await apiRequest<void>("/auth/logout", {
          method: "POST",
          token: currentAccessToken,
          body: JSON.stringify({ refresh_token: currentRefreshToken })
        });
      } catch {
        // ignore logout failures
      }
    }
    clearAuth();
  };

  const request = async <T,>(path: string, init: RequestInit = {}): Promise<T> => {
    const currentAccessToken = accessTokenRef.current;
    if (!currentAccessToken) {
      throw new Error("Потрібна авторизація");
    }
    try {
      return await apiRequest<T>(path, { ...init, token: currentAccessToken });
    } catch (error) {
      const err = error as Error & { status?: number };
      const currentRefreshToken = refreshTokenRef.current;
      if (err.status === 401 && currentRefreshToken) {
        const nextAccess = await refresh(currentRefreshToken);
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
