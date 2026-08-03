import assert from 'node:assert/strict';
import test from 'node:test';
import { ExecutionContext } from '@nestjs/common';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthGuard } from '../src/modules/auth/auth.guard';

test('signin sets an HttpOnly session cookie while preserving the token response', async () => {
    const controller = new AuthController({
        signIn: async () => ({ token: 'signed-token', user: { id: 'user-1', email: 'user@example.com', displayName: null } }),
    } as never);
    let cookie = '';
    const response = { setHeader: (_name: string, value: string) => { cookie = value; }, redirect: () => undefined };

    const result = await controller.signin({ email: 'user@example.com', password: 'password' }, response);

    assert.equal(result.token, 'signed-token');
    assert.match(cookie, /^food-discovery-session=signed-token;/);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
});

test('auth guard accepts the signed session cookie', () => {
    const auth = { verifyToken: (token: string) => ({ id: token, email: 'user@example.com', displayName: null }) };
    const guard = new AuthGuard(auth as never);
    const request: { headers: { authorization?: string; cookie?: string }; user?: unknown } = {
        headers: { cookie: 'other=value; food-discovery-session=cookie-token' },
    };
    const context = {
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    assert.equal(guard.canActivate(context), true);
    assert.deepEqual(request.user, { id: 'cookie-token', email: 'user@example.com', displayName: null });
});

test('auth guard prefers the bearer header over the session cookie', () => {
    const tokens: string[] = [];
    const auth = { verifyToken: (token: string) => { tokens.push(token); return { id: token, email: 'user@example.com', displayName: null }; } };
    const guard = new AuthGuard(auth as never);
    const request = { headers: { authorization: 'Bearer header-token', cookie: 'food-discovery-session=cookie-token' } };
    const context = { switchToHttp: () => ({ getRequest: () => request }) } as unknown as ExecutionContext;

    guard.canActivate(context);

    assert.deepEqual(tokens, ['header-token']);
});

test('logout expires the session cookie', () => {
    const controller = new AuthController({} as never);
    let cookie = '';
    const response = { setHeader: (_name: string, value: string) => { cookie = value; }, redirect: () => undefined };

    assert.deepEqual(controller.logout(response), { loggedOut: true });
    assert.match(cookie, /^food-discovery-session=;/);
    assert.match(cookie, /Max-Age=0/);
    assert.match(cookie, /HttpOnly/);
});