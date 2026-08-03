import { BadRequestException, ConflictException, Injectable, UnauthorizedException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac, randomBytes, scrypt as nodeScrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { DatabaseService } from '../database/database.service';
import type { AuthUser } from './auth.types';
import type { UpdatePreferencesDto } from './preferences.dto';
import { EmailService } from './email.service';

const scrypt = promisify(nodeScrypt);
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

@Injectable()
export class AuthService {
    constructor(private readonly database: DatabaseService, private readonly email?: EmailService) {}
    async signUp(email: string, password: string, confirmPassword: string, displayName?: string) {
        if (password !== confirmPassword) throw new BadRequestException('Mật khẩu xác nhận không khớp.');
        const normalized = email.trim().toLowerCase();
        const exists = await this.database.query('SELECT 1 FROM app_user WHERE email = $1', [normalized]);
        if (exists.rowCount) throw new ConflictException('Email này đã được đăng ký.');
        const hash = await this.hashPassword(password);
        const token = randomBytes(32).toString('hex');
        const tokenHash = this.hashToken(token);
        const result = await this.database.query<AuthUser>('INSERT INTO app_user (email, password_hash, display_name, email_verification_token_hash, email_verification_expires_at) VALUES ($1, $2, $3, $4, now() + interval \'24 hours\') RETURNING id, email, display_name AS "displayName", role', [normalized, hash, displayName?.trim() || null, tokenHash]);
        const delivered = this.email ? await this.email.sendVerificationEmail(normalized, token) : false;
        // Delivery can be connected to SMTP/provider later; return a safe development hint only when explicitly enabled.
        return {
            user: result.rows[0],
            emailVerificationRequired: true,
            ...(process.env.AUTH_EXPOSE_VERIFICATION_LINK === 'true' && !delivered ? { verificationToken: token } : {}),
        };
    }
    async signIn(email: string, password: string) {
        const result = await this.database.query<AuthUser & { password_hash: string }>('SELECT id, email, display_name AS "displayName", role, password_hash FROM app_user WHERE email = $1', [email.trim().toLowerCase()]);
        const user = result.rows[0];
        if (!user || !(await this.verifyPassword(password, user.password_hash))) throw new UnauthorizedException('Email hoặc mật khẩu không đúng.');
        const verified = await this.database.query<{ email_verified_at: string | null }>('SELECT email_verified_at FROM app_user WHERE id = $1', [user.id]);
        if (!verified.rows[0]?.email_verified_at) throw new UnauthorizedException('Vui lòng xác minh email trước khi đăng nhập.');
        return this.session({ id: user.id, email: user.email, displayName: user.displayName, role: user.role ?? 'user' });
    }
    async verifyEmail(token: string) { const result = await this.database.query<{ id: string }>('UPDATE app_user SET email_verified_at = now(), email_verification_token_hash = NULL, email_verification_expires_at = NULL WHERE email_verification_token_hash = $1 AND email_verification_expires_at > now() RETURNING id', [this.hashToken(token)]); if (!result.rowCount) throw new BadRequestException('Liên kết xác minh không hợp lệ hoặc đã hết hạn.'); return { verified: true }; }
    async requestPasswordReset(email: string) {
        const token = randomBytes(32).toString('hex');
        const result = await this.database.query<{ id: string }>('UPDATE app_user SET password_reset_token_hash = $2, password_reset_expires_at = now() + interval \'1 hour\' WHERE email = $1 RETURNING id', [email.trim().toLowerCase(), this.hashToken(token)]);
        const response: { sent: true; resetToken?: string } = { sent: true };
        const delivered = result.rowCount && this.email ? await this.email.sendPasswordResetEmail(email.trim().toLowerCase(), token) : false;
        if (result.rowCount && process.env.AUTH_EXPOSE_RESET_LINK === 'true' && !delivered) response.resetToken = token;
        return response;
    }
    async resetPassword(token: string, password: string, confirmPassword: string) {
        if (password !== confirmPassword) throw new BadRequestException('Mật khẩu xác nhận không khớp.');
        const hash = await this.hashPassword(password);
        const result = await this.database.query<{ id: string }>('UPDATE app_user SET password_hash = $2, password_reset_token_hash = NULL, password_reset_expires_at = NULL WHERE password_reset_token_hash = $1 AND password_reset_expires_at > now() RETURNING id', [this.hashToken(token), hash]);
        if (!result.rowCount) throw new BadRequestException('Liên kết đặt lại mật khẩu không hợp lệ hoặc đã hết hạn.');
        return { reset: true };
    }
    googleAuthorizationUrl() {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${process.env.AUTH_API_ORIGIN ?? 'http://localhost:3000'}/api/v1/auth/google/callback`;
        if (!clientId) throw new ServiceUnavailableException('Google OAuth chưa được cấu hình.');
        const params = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', access_type: 'online', prompt: 'select_account' });
        return { url: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
    }
    async signInWithGoogle(code: string) {
        const clientId = process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
        const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? `${process.env.AUTH_API_ORIGIN ?? 'http://localhost:3000'}/api/v1/auth/google/callback`;
        if (!clientId || !clientSecret) throw new ServiceUnavailableException('Google OAuth chưa được cấu hình.');
        const tokenResponse = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }) });
        if (!tokenResponse.ok) throw new UnauthorizedException('Không thể xác thực tài khoản Google.');
        const tokens = await tokenResponse.json() as { access_token?: string };
        if (!tokens.access_token) throw new UnauthorizedException('Google không trả về access token.');
        const profileResponse = await fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
        if (!profileResponse.ok) throw new UnauthorizedException('Không thể đọc thông tin tài khoản Google.');
        const profile = await profileResponse.json() as { sub?: string; email?: string; name?: string; email_verified?: boolean };
        if (!profile.sub || !profile.email || profile.email_verified === false) throw new UnauthorizedException('Email Google chưa được xác minh.');
        const email = profile.email.trim().toLowerCase();
        const existing = await this.database.query<AuthUser & { auth_provider: string; provider_subject: string | null }>('SELECT id, email, display_name AS "displayName", role, auth_provider, provider_subject FROM app_user WHERE email = $1 OR (auth_provider = \'google\' AND provider_subject = $2) LIMIT 1', [email, profile.sub]);
        let result;
        if (existing.rows[0]) {
            result = await this.database.query<AuthUser>('UPDATE app_user SET email = $2, display_name = COALESCE($3, display_name), email_verified_at = now(), auth_provider = \'google\', provider_subject = $4, password_hash = CASE WHEN password_hash IS NULL OR password_hash = \'\' THEN $5 ELSE password_hash END WHERE id = $1 RETURNING id, email, display_name AS "displayName", role', [existing.rows[0].id, email, profile.name?.trim() || null, profile.sub, `oauth:google:${profile.sub}`]);
        } else {
            result = await this.database.query<AuthUser>('INSERT INTO app_user (email, password_hash, display_name, email_verified_at, auth_provider, provider_subject) VALUES ($1, $2, $3, now(), \'google\', $4) RETURNING id, email, display_name AS "displayName", role', [email, `oauth:google:${profile.sub}`, profile.name?.trim() || null, profile.sub]);
        }
        return this.session(result.rows[0]);
    }
    async getPreferences(userId: string) {
        const result = await this.database.query<{ favorite_category_slugs: string[]; dietary_preferences: string[]; preferred_price_levels: number[]; ai_preferences: Record<string, unknown> }>('SELECT favorite_category_slugs, dietary_preferences, preferred_price_levels, ai_preferences FROM app_user WHERE id = $1', [userId]);
        if (!result.rows[0]) throw new UnauthorizedException('Tài khoản không tồn tại.');
        return this.toPreferences(result.rows[0]);
    }
    async updatePreferences(userId: string, body: UpdatePreferencesDto) {
        const hasAiPreferences = body.aiPreferences !== undefined;
        const sql = hasAiPreferences
            ? 'UPDATE app_user SET favorite_category_slugs = COALESCE($2, favorite_category_slugs), dietary_preferences = COALESCE($3, dietary_preferences), preferred_price_levels = COALESCE($4, preferred_price_levels), ai_preferences = COALESCE($5, ai_preferences) WHERE id = $1 RETURNING favorite_category_slugs, dietary_preferences, preferred_price_levels, ai_preferences'
            : 'UPDATE app_user SET favorite_category_slugs = COALESCE($2, favorite_category_slugs), dietary_preferences = COALESCE($3, dietary_preferences), preferred_price_levels = COALESCE($4, preferred_price_levels) WHERE id = $1 RETURNING favorite_category_slugs, dietary_preferences, preferred_price_levels';
        const values = [userId, body.favoriteCategorySlugs ?? null, body.dietaryPreferences ?? null, body.preferredPriceLevels ?? null, ...(hasAiPreferences ? [JSON.stringify(body.aiPreferences)] : [])];
        const result = await this.database.query<{ favorite_category_slugs: string[]; dietary_preferences: string[]; preferred_price_levels: number[]; ai_preferences?: Record<string, unknown> }>(sql, values);
        if (!result.rows[0]) throw new UnauthorizedException('Tài khoản không tồn tại.');
        return this.toPreferences(result.rows[0]);
    }
    private toPreferences(row: { favorite_category_slugs: string[]; dietary_preferences: string[]; preferred_price_levels: number[]; ai_preferences?: Record<string, unknown> }) {
        const ai = row.ai_preferences ?? {};
        const preferences = { favoriteCategorySlugs: row.favorite_category_slugs ?? [], dietaryPreferences: row.dietary_preferences ?? [], preferredPriceLevels: row.preferred_price_levels ?? [] };
        return Object.prototype.hasOwnProperty.call(row, 'ai_preferences')
            ? { ...preferences, aiPreferences: { ...ai, dietaryPreferences: ai.dietaryPreferences ?? preferences.dietaryPreferences } }
            : preferences;
    }
    verifyToken(token: string): AuthUser {
        const parts = token.split('.');
        const [encoded, signature] = parts;
        if (parts.length !== 2) throw new UnauthorizedException('Phiên đăng nhập không hợp lệ.');
        if (!encoded || !signature) throw new UnauthorizedException('Phiên đăng nhập không hợp lệ.');
        const expected = this.sign(encoded);
        if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new UnauthorizedException('Phiên đăng nhập không hợp lệ.');
        let payload: Partial<AuthUser> & { exp?: unknown };
        try {
            payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as Partial<AuthUser> & { exp?: unknown };
        } catch {
            throw new UnauthorizedException('Phiên đăng nhập không hợp lệ.');
        }
        if (typeof payload.id !== 'string' || typeof payload.email !== 'string' || (payload.displayName !== null && typeof payload.displayName !== 'string') || (payload.role !== undefined && payload.role !== 'user' && payload.role !== 'admin') || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) {
            throw new UnauthorizedException('Phiên đăng nhập không hợp lệ.');
        }
        if (payload.exp < Math.floor(Date.now() / 1000)) throw new UnauthorizedException('Phiên đăng nhập đã hết hạn.');
        return {
            id: payload.id,
            email: payload.email,
            displayName: payload.displayName,
            ...(payload.role ? { role: payload.role } : {}),
        };
    }
    private session(user: AuthUser) { const encoded = Buffer.from(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + TOKEN_TTL_SECONDS })).toString('base64url'); return { token: `${encoded}.${this.sign(encoded)}`, user }; }
    private sign(value: string) { return createHmac('sha256', process.env.AUTH_SECRET ?? 'local-development-secret-change-me').update(value).digest('base64url'); }
    private hashToken(value: string) { return createHmac('sha256', process.env.AUTH_SECRET ?? 'local-development-secret-change-me').update(value).digest('hex'); }
    private async hashPassword(password: string) { const salt = randomBytes(16).toString('hex'); const derived = await scrypt(password, salt, 64) as Buffer; return `scrypt:${salt}:${derived.toString('hex')}`; }
    private async verifyPassword(password: string, stored: string) { const [, salt, hex] = stored.split(':'); if (!salt || !hex) return false; const derived = await scrypt(password, salt, 64) as Buffer; const expected = Buffer.from(hex, 'hex'); return expected.length === derived.length && timingSafeEqual(expected, derived); }
}