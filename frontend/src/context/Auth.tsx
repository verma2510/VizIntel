import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { flush as flushTracker } from "../lib/tracker";
import { api, setUnauthorizedHandler } from "../lib/api";
import type { User } from "../types";

export type { User };

interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (userData: User, tokenStr: string, redirectTo?: string) => void;
  logout: () => void;
  updateUser: (user: User) => void;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const readStored = (): { token: string | null; user: User | null } => {
  try {
    const token = localStorage.getItem("token");
    const user = localStorage.getItem("user");
    return token && user ? { token, user: JSON.parse(user) as User } : { token: null, user: null };
  } catch {
    return { token: null, user: null };
  }
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Read synchronously so protected routes never flash the login page on reload.
  const [{ token, user }, setSession] = useState(readStored);
  const navigate = useNavigate();

  const login = useCallback(
    (userData: User, tokenStr: string, redirectTo = "/app") => {
      setSession({ token: tokenStr, user: userData });
      localStorage.setItem("token", tokenStr);
      localStorage.setItem("user", JSON.stringify(userData));
      navigate(redirectTo, { replace: true });
    },
    [navigate]
  );

  const logout = useCallback(() => {
    // Ship queued interaction events while the token is still available, so they stay attributed.
    void flushTracker({ keepalive: true });
    setSession({ token: null, user: null });
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    navigate("/login", { replace: true });
  }, [navigate]);

  const updateUser = useCallback((next: User) => {
    setSession((s) => ({ ...s, user: next }));
    localStorage.setItem("user", JSON.stringify(next));
  }, []);

  // Any authenticated request answering 401 ends the session centrally.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Refresh the profile once per session (also detects tokens revoked or expired server-side).
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    api<{ user: User }>("/api/auth/me", { signal: controller.signal })
      .then(({ user: fresh }) => updateUser(fresh))
      .catch(() => {
        // network errors are ignored; a 401 already triggered logout via the handler
      });
    return () => controller.abort();
  }, [token, updateUser]);

  const value = useMemo(() => ({ user, token, login, logout, updateUser, loading: false }), [user, token, login, logout, updateUser]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
