import { createContext, useContext } from 'react';
import type { User, LoginResponse } from '../lib/types';

export interface AuthContextType {
  user: User | null;
  token: string | null;
  login: (response: LoginResponse) => void;
  logout: () => void;
  isAuthenticated: boolean;
  /** False until the backend has said whether a session exists. */
  ready: boolean;
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
