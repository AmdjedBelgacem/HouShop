import { createContext, useContext, useState, type ReactNode } from 'react';
import type { User, LoginResponse } from '../lib/types';
interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (response: LoginResponse) => void;
  logout: () => void;
  isAuthenticated: boolean;
}
const AuthContext = createContext<AuthContextType | undefined>(undefined);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => {
    const saved = localStorage.getItem('shop_user');
    return saved ? JSON.parse(saved) : null;
  });
  const [token, setToken] = useState<string | null>(() => {
    return localStorage.getItem('shop_token');
  });
  const login = (response: LoginResponse) => {
    setUser(response.user);
    setToken(response.token);
    localStorage.setItem('shop_user', JSON.stringify(response.user));
    localStorage.setItem('shop_token', response.token);
  };
  const logout = () => {
    setUser(null);
    setToken(null);
    localStorage.removeItem('shop_user');
    localStorage.removeItem('shop_token');
  };
  return (
    <AuthContext.Provider value={{ user, token, login, logout, isAuthenticated: !!user }}>
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
