import { AdminError } from '../../error/errors/AdminError';

export const request = async <T>(
  path: string,
  init: RequestInit = {}
): Promise<T> => {
  const response = await fetch(`/api/admin${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    if (response.status === 401 && path !== '/login') {
      window.dispatchEvent(new Event('admin-session-expired'));
    }
    const message =
      typeof body === 'object' && body !== null && 'message' in body
        ? String((body as { message: unknown }).message)
        : 'Something went wrong.';
    throw new AdminError(message, response.status, body);
  }

  return body as T;
};

export const get = <T>(path: string): Promise<T> => request<T>(path);

export const post = <T>(path: string, body?: unknown): Promise<T> =>
  request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });

export const patch = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });

export const put = <T>(path: string, body: unknown): Promise<T> =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) });

export const del = <T>(path: string): Promise<T> =>
  request<T>(path, { method: 'DELETE' });
