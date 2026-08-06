import { useAuth as useAuthStore } from './auth-session-store';
import { clearStoredAuth, getStoredUser, setStoredUser } from './auth-storage';
export { clearStoredAuth, getStoredUser, setStoredUser } from './auth-storage';
export function useAuth() {
  return useAuthStore();
}
