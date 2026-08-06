import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { AdminAuthorizationGuard } from '../src/modules/admin/admin-authorization.guard';

function context(headers: Record<string, string | undefined>, user?: { role?: string }) {
  const request = { headers, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    request,
  } as never;
}

test('role admin is accepted without the legacy api key', () => {
  let keyCalls = 0;
  const guard = new AdminAuthorizationGuard(
    {
      canActivate: (ctx: any) => {
        ctx.request.user = { role: 'admin' };
        return true;
      },
    } as never,
    {
      canActivate: () => {
        keyCalls += 1;
        return true;
      },
    } as never,
  );
  assert.equal(guard.canActivate(context({ authorization: 'Bearer token' })), true);
  assert.equal(keyCalls, 0);
});

test('role user is rejected and does not fall back to the legacy api key', () => {
  let keyCalls = 0;
  const guard = new AdminAuthorizationGuard(
    {
      canActivate: (ctx: any) => {
        ctx.request.user = { role: 'user' };
        return true;
      },
    } as never,
    {
      canActivate: () => {
        keyCalls += 1;
        return true;
      },
    } as never,
  );
  assert.throws(
    () => guard.canActivate(context({ authorization: 'Bearer token' })),
    ForbiddenException,
  );
  assert.equal(keyCalls, 0);
});

test('session cookie is treated as session credentials', () => {
  let authCalls = 0;
  const guard = new AdminAuthorizationGuard(
    {
      canActivate: (ctx: any) => {
        authCalls += 1;
        ctx.request.user = { role: 'admin' };
        return true;
      },
    } as never,
    {
      canActivate: () => {
        throw new Error('legacy key should not run');
      },
    } as never,
  );
  assert.equal(guard.canActivate(context({ cookie: 'food-discovery-session=token' })), true);
  assert.equal(authCalls, 1);
});

test('requests without session credentials use the legacy api key', () => {
  let keyCalls = 0;
  const guard = new AdminAuthorizationGuard(
    {
      canActivate: () => {
        throw new Error('auth should not run');
      },
    } as never,
    {
      canActivate: () => {
        keyCalls += 1;
        return true;
      },
    } as never,
  );
  assert.equal(guard.canActivate(context({ 'x-admin-api-key': 'configured' })), true);
  assert.equal(keyCalls, 1);
});
