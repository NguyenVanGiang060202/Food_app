export type AuthRole = 'user' | 'admin';

export interface AuthUser {
    id: string;
    email: string;
    displayName: string | null;
    role?: AuthRole;
}