import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
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

export type CodeIntent = 'signin' | 'register' | 'join';

export type RequestCodeResult = AuthResult & {
  /** Only returned by a dev server without a real email provider */
  devCode?: string;
  retryAfterSeconds?: number;
};

export type CompanyChoice = { id: number; name: string; role: 'ADMIN' | 'USER' };

/** `companies` is set when the email belongs to several companies and one must be picked. */
export type SignInResult = AuthResult & { companies?: CompanyChoice[] };

type AuthContextValue = {
  state: AuthState;
  requestCode: (input: {
    intent: CodeIntent;
    email: string;
    invitationCode?: string;
  }) => Promise<RequestCodeResult>;
  signIn: (input: { email: string; code: string; companyId?: number }) => Promise<SignInResult>;
  registerCompany: (input: {
    email: string;
    code: string;
    name: string;
    companyName: string;
  }) => Promise<AuthResult>;
  joinCompany: (input: {
    email: string;
    code: string;
    name: string;
    invitationCode: string;
  }) => Promise<AuthResult>;
  signOut: () => Promise<void>;
  retry: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ status: 'loading' });
  const queryClient = useQueryClient();

  // Query keys aren't scoped per user/company, so cached data from the previous
  // session must be dropped whenever the signed-in identity changes. Otherwise
  // joining company B still shows company A's battery types, requests, etc.
  const resetCache = useCallback(async () => {
    await queryClient.cancelQueries();
    queryClient.clear();
  }, [queryClient]);

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
      await resetCache();
      setState({ status: 'signedOut' });
      return;
    }
    if (res.ok && res.json) {
      setState({ status: 'signedIn', user: res.json.user, company: res.json.company, token });
      return;
    }
    setState({ status: 'signedOut' });
  }, [resetCache]);

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  const saveAndEnter = useCallback(
    async (token: string, user: User, company: Company) => {
      await storeToken(token);
      await resetCache();
      setState({ status: 'signedIn', user, company, token });
    },
    [resetCache],
  );

  const requestCode: AuthContextValue['requestCode'] = useCallback(async (input) => {
    const res = await apiRequest<{ devCode?: string; details?: { retryAfterSeconds?: number } }>(
      '/auth/request-code',
      { method: 'POST', body: input },
    );
    if (res.networkError) return { ok: false, error: 'Cannot reach server. Check connection.' };
    if (!res.ok) {
      return {
        ok: false,
        error: extractErrorMessage(res.json, 'Could not send code'),
        retryAfterSeconds: res.json?.details?.retryAfterSeconds,
      };
    }
    return { ok: true, devCode: res.json?.devCode };
  }, []);

  const signIn: AuthContextValue['signIn'] = useCallback(
    async (input) => {
      const res = await apiRequest<{
        token?: string;
        user?: User;
        company?: Company;
        needsCompany?: boolean;
        companies?: CompanyChoice[];
      }>('/auth/sign-in', { method: 'POST', body: input });
      if (res.networkError) return { ok: false, error: 'Cannot reach server. Check connection.' };
      if (!res.ok) return { ok: false, error: extractErrorMessage(res.json, 'Sign-in failed') };
      if (res.json?.needsCompany && res.json.companies) {
        return { ok: false, companies: res.json.companies };
      }
      if (res.json?.token && res.json.user && res.json.company) {
        await saveAndEnter(res.json.token, res.json.user, res.json.company);
        return { ok: true };
      }
      return { ok: false, error: 'Unexpected server response' };
    },
    [saveAndEnter],
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
    await resetCache();
    setState({ status: 'signedOut' });
    if (token) {
      // Fire-and-forget — even if this fails, we've cleared the local token
      void apiRequest('/auth/logout', { method: 'POST', token });
    }
  }, [resetCache]);

  const retry = useCallback(async () => {
    await bootstrap();
  }, [bootstrap]);

  return (
    <AuthContext.Provider
      value={{ state, requestCode, signIn, registerCompany, joinCompany, signOut, retry }}
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
