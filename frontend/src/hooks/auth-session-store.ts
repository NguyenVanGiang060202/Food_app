import { useSyncExternalStore } from 'react';
import { readSessionResponse } from '../lib/auth-session';
import { clearStoredAuth, getStoredUser, setStoredUser, type LocalUser } from './auth-storage';

type AuthState = { user: LocalUser | null; loading: boolean };
type Listener = () => void;

let state: AuthState = { user: getStoredUser(), loading: true };
let refreshPromise: Promise<void> | null = null;
const listeners = new Set<Listener>();
let browserListenersInstalled = false;

function emit() {
  listeners.forEach((listener) => listener());
}

function syncStoredUser() {
  state = { ...state, user: getStoredUser() };
  emit();
}

function installBrowserListeners() {
  if (browserListenersInstalled || typeof window === 'undefined') return;
  browserListenersInstalled = true;
  window.addEventListener('storage', syncStoredUser);
  window.addEventListener('bep:auth-change', syncStoredUser);
}

function subscribe(listener: Listener) {
  installBrowserListeners();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

async function restoreSession() {
  const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '/api/v1').replace(/\/$/, '');
  try {
    const response = await fetch(`${apiBase}/auth/me`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const sessionUser = await readSessionResponse(response);
    if (sessionUser) setStoredUser(sessionUser);
    else clearStoredAuth();
  } catch {
    // Keep the cached profile for transient network/server failures.
  } finally {
    state = { user: getStoredUser(), loading: false };
    emit();
  }
}

export function initializeAuth() {
  installBrowserListeners();
  if (!refreshPromise) refreshPromise = restoreSession();
  return refreshPromise;
}

export function useAuth() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  initializeAuth();
  return snapshot;
}
