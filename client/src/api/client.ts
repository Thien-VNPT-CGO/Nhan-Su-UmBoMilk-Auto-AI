const getApiBase = () => {
  const metaEnv = (import.meta as unknown as { env?: { VITE_API_URL?: string; VITE_API_BASE_URL?: string } }).env;
  const customUrl = metaEnv?.VITE_API_URL || metaEnv?.VITE_API_BASE_URL;
  if (customUrl) {
    const trimmed = customUrl.replace(/\/+$/, '');
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  }
  return '/api';
};

const BASE = getApiBase();

export class ApiError extends Error {
  code: string;
  status: number;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  const res = await fetch(`${BASE}${path}`, { ...options, headers, credentials: 'include' });
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    body = null;
  }
  if (!res.ok) {
    const b = body as { code?: string; message?: string } | null;
    throw new ApiError(res.status, b?.code ?? 'ERROR', b?.message ?? 'Lỗi hệ thống.');
  }
  const b = body as { success: boolean; data: T };
  return b.data;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};