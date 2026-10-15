/* eslint-disable react-refresh/only-export-components */
import { ReactNode, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ApiError, apiRequest, setUnauthorizedHandler } from '../lib/api';
import { clearLegacyCustomerSession, CustomerProfile } from '../lib/session';

export type AuthState =
  | { status: 'loading'; customer: null; error: null }
  | { status: 'authenticated'; customer: CustomerProfile; error: null }
  | { status: 'anonymous'; customer: null; error: null }
  | { status: 'error'; customer: null; error: string };

type AuthContextValue = AuthState & {
  retry: () => Promise<void>;
  login: (email: string, password: string) => Promise<CustomerProfile>;
  logout: () => Promise<void>;
  updateProfile: (profile: Pick<CustomerProfile, 'firstName' | 'lastName' | 'address'>) => Promise<CustomerProfile>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, initialState }: { children: ReactNode; initialState?: AuthState }) {
  const [state, setState] = useState<AuthState>(initialState ?? { status: 'loading', customer: null, error: null });

  const loadSession = useCallback(async () => {
    setState({ status: 'loading', customer: null, error: null });
    try {
      const customer = await apiRequest<CustomerProfile>('/api/session');
      setState({ status: 'authenticated', customer, error: null });
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        setState({ status: 'anonymous', customer: null, error: null });
      } else {
        setState({
          status: 'error',
          customer: null,
          error: error instanceof Error ? error.message : 'Unable to verify your session.',
        });
      }
    }
  }, []);

  useEffect(() => {
    clearLegacyCustomerSession();
    setUnauthorizedHandler(() => setState({ status: 'anonymous', customer: null, error: null }));
    if (!initialState) void loadSession();
    return () => setUnauthorizedHandler(null);
  }, [initialState, loadSession]);

  const login = useCallback(async (email: string, password: string) => {
    const customer = await apiRequest<CustomerProfile>('/api/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    setState({ status: 'authenticated', customer, error: null });
    return customer;
  }, []);

  const logout = useCallback(async () => {
    try {
      await apiRequest<void>('/api/logout', { method: 'POST' });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 401) throw error;
    }
    setState({ status: 'anonymous', customer: null, error: null });
  }, []);

  const updateProfile = useCallback(async (profile: Pick<CustomerProfile, 'firstName' | 'lastName' | 'address'>) => {
    const customer = await apiRequest<CustomerProfile>('/api/profile', { method: 'PUT', body: JSON.stringify(profile) });
    setState({ status: 'authenticated', customer, error: null });
    return customer;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({ ...state, retry: loadSession, login, logout, updateProfile }), [state, loadSession, login, logout, updateProfile]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider.');
  return context;
}
