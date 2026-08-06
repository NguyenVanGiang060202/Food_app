export function createApiRequest(init: RequestInit = {}): RequestInit {
  return {
    ...init,
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(init.headers ?? {}),
    },
  };
}
