import { useState, useEffect, type ReactNode } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { User, LoginResponse } from '../lib/types';
import { AuthContext } from './authContext';

/** Fired when the backend answers "Not signed in" (e.g. it restarted). */
export const AUTH_EXPIRED_EVENT = 'auth:expired';

export function AuthProvider({ children }: { children: ReactNode }) {
  // The backend owns the session. Nothing about who is signed in is trusted
  // from local storage: on load we ask the backend, and until it answers the
  // app renders nothing (see `ready`).
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // Clear what older versions stored here.
    try {
      localStorage.removeItem('shop_user');
      localStorage.removeItem('shop_token');
    } catch { /* storage unavailable: nothing to clear */ }
    invoke<User | null>('session_user')
      .then((u) => { if (!cancelled && u) setUser(u); })
      .catch(() => { /* no session: show sign-in */ })
      .finally(() => { if (!cancelled) setReady(true); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const expire = () => { setUser(null); setToken(null); };
    window.addEventListener(AUTH_EXPIRED_EVENT, expire);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expire);
  }, []);

  const login = (response: LoginResponse) => {
    setUser(response.user);
    setToken(response.token);
  };
  const logout = () => {
    // End the session in the backend first, so nothing can run after sign-out.
    invoke('logout').catch(() => { /* already signed out */ });
    setUser(null);
    setToken(null);
  };
  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated: !!user, ready }}>
      {children}
    </AuthContext.Provider>
  );
}
