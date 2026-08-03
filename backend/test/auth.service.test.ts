import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { AuthService } from '../src/modules/auth/auth.service';

const service = new AuthService(undefined as never);

test('signUp does not issue a session before email verification', async () => {
    const queries: string[] = [];
    const database = {
        query: async <T>(sql: string): Promise<{ rows: T[]; rowCount: number }> => {
            queries.push(sql);
            if (sql.startsWith('SELECT 1')) return { rows: [], rowCount: 0 };
            return { rows: [{ id: 'user-1', email: 'user@example.com', displayName: 'User' } as T], rowCount: 1 };
        },
    };
    const auth = new AuthService(database as never);

    const result = await auth.signUp('USER@example.com', 'password', 'password', 'User');

    assert.deepEqual(result.user, { id: 'user-1', email: 'user@example.com', displayName: 'User' });
    assert.equal(result.emailVerificationRequired, true);
    assert.equal('token' in result, false);
    assert.equal(queries.length, 2);
});

test('signUp does not expose a verification token when email delivery succeeds', async () => {
    const database = {
        query: async <T>(sql: string): Promise<{ rows: T[]; rowCount: number }> => sql.startsWith('SELECT 1')
            ? { rows: [], rowCount: 0 }
            : { rows: [{ id: 'user-2', email: 'user@example.com', displayName: null } as T], rowCount: 1 },
    };
    const email = { sendVerificationEmail: async () => true };
    const previous = process.env.AUTH_EXPOSE_VERIFICATION_LINK;
    process.env.AUTH_EXPOSE_VERIFICATION_LINK = 'true';

    try {
        const auth = new AuthService(database as never, email as never);
        const result = await auth.signUp('user@example.com', 'password', 'password');
        assert.equal('verificationToken' in result, false);
    } finally {
        if (previous === undefined) delete process.env.AUTH_EXPOSE_VERIFICATION_LINK;
        else process.env.AUTH_EXPOSE_VERIFICATION_LINK = previous;
    }
});

test('verifyToken converts malformed payloads into 401 errors', () => {
    const encoded = Buffer.from('{not-json', 'utf8').toString('base64url');

    assert.throws(
        () => service.verifyToken(`${encoded}.invalid`),
        (error: unknown) => error instanceof UnauthorizedException && /không hợp lệ/.test(error.message),
    );
});

test('verifyToken rejects tokens with an unexpected number of segments', () => {
    assert.throws(
        () => service.verifyToken('encoded.signature.extra'),
        (error: unknown) => error instanceof UnauthorizedException && /không hợp lệ/.test(error.message),
    );
});

test('verifyToken rejects an expired signed session', () => {
    const previousSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = 'test-auth-secret';
    try {
        const encoded = Buffer.from(JSON.stringify({ id: 'user-1', email: 'user@example.com', displayName: null, exp: Math.floor(Date.now() / 1000) - 1 })).toString('base64url');
        const signature = createHmac('sha256', 'test-auth-secret').update(encoded).digest('base64url');

        assert.throws(
            () => service.verifyToken(`${encoded}.${signature}`),
            (error: unknown) => error instanceof UnauthorizedException && /hết hạn/.test(error.message),
        );
    } finally {
        if (previousSecret === undefined) delete process.env.AUTH_SECRET;
        else process.env.AUTH_SECRET = previousSecret;
    }
});

test('verifyToken returns the identity encoded in the signed token', () => {
    const previousSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = 'test-auth-secret';
    try {
        const encoded = Buffer.from(JSON.stringify({ id: 'user-2', email: 'other@example.com', displayName: 'Other', exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url');
        const signature = createHmac('sha256', 'test-auth-secret').update(encoded).digest('base64url');

        assert.deepEqual(service.verifyToken(`${encoded}.${signature}`), { id: 'user-2', email: 'other@example.com', displayName: 'Other' });
    } finally {
        if (previousSecret === undefined) delete process.env.AUTH_SECRET;
        else process.env.AUTH_SECRET = previousSecret;
    }
});

test('getPreferences maps database columns to the public preferences contract', async () => {
    const database = {
        query: async <T>(): Promise<{ rows: T[]; rowCount: number }> => ({
            rows: [{ favorite_category_slugs: ['pho'], dietary_preferences: ['vegetarian'], preferred_price_levels: [1, 2] } as T],
            rowCount: 1,
        }),
    };
    const auth = new AuthService(database as never);

    const result = await auth.getPreferences('user-1');

    assert.deepEqual(result, { favoriteCategorySlugs: ['pho'], dietaryPreferences: ['vegetarian'], preferredPriceLevels: [1, 2] });
});

test('updatePreferences persists only supplied preference fields', async () => {
    let receivedValues: unknown[] = [];
    const database = {
        query: async <T>(_sql: string, values: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> => {
            receivedValues = values;
            return { rows: [{ favorite_category_slugs: ['bun'], dietary_preferences: [], preferred_price_levels: [3] } as T], rowCount: 1 };
        },
    };
    const auth = new AuthService(database as never);

    const result = await auth.updatePreferences('user-1', { favoriteCategorySlugs: ['bun'], preferredPriceLevels: [3] });

    assert.deepEqual(receivedValues, ['user-1', ['bun'], null, [3]]);
    assert.deepEqual(result, { favoriteCategorySlugs: ['bun'], dietaryPreferences: [], preferredPriceLevels: [3] });
});

test('requestPasswordReset returns a generic response for an unknown email', async () => {
    const database = {
        query: async <T>(): Promise<{ rows: T[]; rowCount: number }> => ({ rows: [], rowCount: 0 }),
    };
    const auth = new AuthService(database as never);

    const result = await auth.requestPasswordReset('Nobody@Example.com');

    assert.deepEqual(result, { sent: true });
});

test('resetPassword updates the password and clears the reset token', async () => {
    let sql = '';
    let values: unknown[] = [];
    const database = {
        query: async <T>(query: string, params: unknown[] = []): Promise<{ rows: T[]; rowCount: number }> => {
            sql = query;
            values = params;
            return { rows: [{ id: 'user-1' } as T], rowCount: 1 };
        },
    };
    const auth = new AuthService(database as never);

    const result = await auth.resetPassword('a'.repeat(32), 'new-password', 'new-password');

    assert.deepEqual(result, { reset: true });
    assert.match(sql, /password_reset_token_hash = NULL/);
    assert.match(sql, /password_reset_expires_at = NULL/);
    assert.equal(values.length, 2);
    assert.equal(typeof values[0], 'string');
    assert.match(values[1] as string, /^scrypt:/);
});

test('resetPassword rejects mismatched passwords before querying the database', async () => {
    let called = false;
    const database = {
        query: async <T>(): Promise<{ rows: T[]; rowCount: number }> => {
            called = true;
            return { rows: [], rowCount: 0 };
        },
    };
    const auth = new AuthService(database as never);

    await assert.rejects(
        () => auth.resetPassword('a'.repeat(32), 'new-password', 'different-password'),
        (error: unknown) => error instanceof BadRequestException,
    );
    assert.equal(called, false);
});

test('googleAuthorizationUrl uses the backend callback origin', () => {
    const previousClientId = process.env.GOOGLE_CLIENT_ID;
    const previousRedirect = process.env.GOOGLE_REDIRECT_URI;
    const previousApiOrigin = process.env.AUTH_API_ORIGIN;
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    delete process.env.GOOGLE_REDIRECT_URI;
    process.env.AUTH_API_ORIGIN = 'http://localhost:3000';

    try {
        const auth = new AuthService(undefined as never);
        const result = auth.googleAuthorizationUrl();
        const url = new URL(result.url);

        assert.equal(url.searchParams.get('client_id'), 'client-id');
        assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:3000/api/v1/auth/google/callback');
    } finally {
        if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
        else process.env.GOOGLE_CLIENT_ID = previousClientId;
        if (previousRedirect === undefined) delete process.env.GOOGLE_REDIRECT_URI;
        else process.env.GOOGLE_REDIRECT_URI = previousRedirect;
        if (previousApiOrigin === undefined) delete process.env.AUTH_API_ORIGIN;
        else process.env.AUTH_API_ORIGIN = previousApiOrigin;
    }
});

test('googleAuthorizationUrl reports missing OAuth configuration', () => {
    const previousClientId = process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_ID;

    try {
        const auth = new AuthService(undefined as never);
        assert.throws(() => auth.googleAuthorizationUrl(), (error: unknown) => error instanceof ServiceUnavailableException);
    } finally {
        if (previousClientId === undefined) delete process.env.GOOGLE_CLIENT_ID;
        else process.env.GOOGLE_CLIENT_ID = previousClientId;
    }
});