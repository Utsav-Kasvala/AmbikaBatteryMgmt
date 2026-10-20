const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

export const API_BASE = BASE;

export type ApiResponse<T = unknown> = {
  ok: boolean;
  status: number;
  json: T | null;
  networkError: boolean;
};

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

export async function apiRequest<T = unknown>(
  path: string,
  options: { method?: Method; body?: unknown; token?: string | null } = {},
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, token } = options;

  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json: unknown = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
    }

    return { ok: res.ok, status: res.status, json: json as T | null, networkError: false };
  } catch {
    return { ok: false, status: 0, json: null, networkError: true };
  }
}

export function extractErrorMessage(json: unknown, fallback = 'Something went wrong'): string {
  if (typeof json === 'string' && json.length > 0) return json;
  if (json && typeof json === 'object' && 'error' in json) {
    const err = (json as { error: unknown }).error;
    if (typeof err === 'string') return err;
  }
  return fallback;
}
