import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { apiRequest, extractErrorMessage } from '../api/client';
import { clearToken, getToken, setToken as storeToken } from './session';

export type User = {
  id: number;
  email: string;
  name: string;
  role: 'ADMIN' | 'USER';
  status: 'ACTIVE' | 'DEACTIVATED';
  companyId: number;
};

export type Company = {
  id: number;
  name: string;
  invitationCode?: string;
};

export type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut' }
  | { status: 'signedIn'; user: User; company: Company; token: string }
  | { status: 'networkError'; message: string };

export type AuthResult = { ok: boolean; error?: string };

type AuthContextValue = {
  state: AuthState;
  registerCompany: (input: {
    email: string;
    name: string;
    companyName: string;
  }) => Promise<AuthResult>;
  joinCompany: (input: {
    email: string;
    name: string;
    invitationCode: string;
  }) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });

  const bootstrap = useCallback(async () => {
    setState({ status: 'loading' });
    const token = await getToken();
    if (!token) {
      setState({ status: 'signedOut' });
      return;
    }

    const res = await apiRequest<{ user: User; company: Company }>('/auth/me', { token });
    if (res.networkError) {
      setState({
        status: 'networkError',
        message: 'Cannot reach server. Check your connection and try again.',
      });
      return;
    }
    if (res.status === 401 || res.status === 403) {
      await clearToken();
      setState({ status: 'signedOut' });
      return;
    }
    if (res.ok && res.json) {
      setState({ status: 'signedIn', user: res.json.user, company: res.json.company, token });
      return;
    }
    setState({ status: 'signedOut' });
  }, []);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const saveAndEnter = useCallback(
    async (token: string, user: User, company: Company) => {
      await storeToken(token);
      setState({ status: 'signedIn', user, company, token });
    },
    [],
  );

  const registerCompany: AuthContextValue['registerCompany'] = useCallback(
    async (input) => {
      const res = await apiRequest<{ token: string; user: User; company: Company }>(
        '/auth/register-company',
        { method: 'POST', body: input },
      );
      if (res.networkError) return { ok: false, error: 'Cannot reach server. Check connection.' };
      if (!res.ok) return { ok: false, error: extractErrorMessage(res.json) };
      if (res.json?.token && res.json.user && res.json.company) {
        await saveAndEnter(res.json.token, res.json.user, res.json.company);
        return { ok: true };
      }
      return { ok: false, error: 'Unexpected server response' };
    },
    [saveAndEnter],
  );

  const joinCompany: AuthContextValue['joinCompany'] = useCallback(
    async (input) => {
      const res = await apiRequest<{ token: string; user: User; company: Company }>(
        '/auth/join-company',
        { method: 'POST', body: input },
      );
      if (res.networkError) return { ok: false, error: 'Cannot reach server. Check connection.' };
      if (!res.ok) return { ok: false, error: extractErrorMessage(res.json) };
      if (res.json?.token && res.json.user && res.json.company) {
        await saveAndEnter(res.json.token, res.json.user, res.json.company);
        return { ok: true };
      }
      return { ok: false, error: 'Unexpected server response' };
    },
    [saveAndEnter],
  );

  const signOut = useCallback(async () => {
    const token = await getToken();
    await clearToken();
    setState({ status: 'signedOut' });
    if (token) {
      // Fire-and-forget — even if this fails, we've cleared the local token
      void apiRequest('/auth/logout', { method: 'POST', token });
    }
  }, []);

  const retry = useCallback(async () => {
    await bootstrap();
  }, [bootstrap]);

  return (
    <AuthContext.Provider
      value={{ state, registerCompany, joinCompany, signOut, retry }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
