export type LocalUser = { id?: string; email: string; displayName?: string | null };

const USER_KEY = 'food-discovery:auth-user';

export function getStoredUser(): LocalUser | null {
  try {
    return JSON.parse(window.localStorage.getItem(USER_KEY) ?? 'null') as LocalUser | null;
  } catch {
    return null;
  }
}

export function setStoredUser(user: LocalUser) {
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
  window.dispatchEvent(new Event('bep:auth-change'));
}

export function clearStoredAuth() {
  window.localStorage.removeItem(USER_KEY);
  window.dispatchEvent(new Event('bep:auth-change'));
}
