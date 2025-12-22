import React, { createContext, useContext, useEffect, useState } from 'react';
import { apiRequest } from './api';

interface AuthContextValue {
  token: string | null;
  email: string | null;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [token, setToken] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    const t = localStorage.getItem('token');
    const e = localStorage.getItem('email');
    if (t) setToken(t);
    if (e) setEmail(e);
  }, []);

  const login = async (email: string, password: string) => {
    const data = await apiRequest('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
    setToken(data.token);
    setEmail(email);
    localStorage.setItem('token', data.token);
    localStorage.setItem('email', email);
  };

  const register = async (email: string, password: string) => {
    await apiRequest('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password })
    });
  };

  const logout = () => {
    setToken(null);
    setEmail(null);
    localStorage.removeItem('token');
    localStorage.removeItem('email');
  };

  return (
    <AuthContext.Provider value={{ token, email, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
