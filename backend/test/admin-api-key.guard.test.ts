import assert from 'node:assert/strict';
import test from 'node:test';
import { ForbiddenException, ServiceUnavailableException } from '@nestjs/common';
import { AdminApiKeyGuard } from '../src/modules/admin/admin-api-key.guard';

function context(headers: Record<string, string | string[] | undefined>) {
    return {
        switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    } as never;
}

const originalKey = process.env.ADMIN_API_KEY;
const restoreKey = () => {
    if (originalKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = originalKey;
};

test.afterEach(restoreKey);

test('admin key guard accepts the configured key', () => {
    process.env.ADMIN_API_KEY = 'test-admin-key';
    assert.equal(new AdminApiKeyGuard().canActivate(context({ 'x-admin-api-key': 'test-admin-key' })), true);
});

test('admin key guard rejects a missing or invalid key', () => {
    process.env.ADMIN_API_KEY = 'test-admin-key';
    const guard = new AdminApiKeyGuard();
    assert.throws(() => guard.canActivate(context({})), ForbiddenException);
    assert.throws(() => guard.canActivate(context({ 'x-admin-api-key': 'wrong-key' })), ForbiddenException);
});

test('admin key guard accepts the first value from a repeated header', () => {
    process.env.ADMIN_API_KEY = 'test-admin-key';
    assert.equal(new AdminApiKeyGuard().canActivate(context({ 'x-admin-api-key': ['test-admin-key', 'other'] })), true);
});

test('admin key guard reports missing configuration', () => {
    delete process.env.ADMIN_API_KEY;
    assert.throws(() => new AdminApiKeyGuard().canActivate(context({ 'x-admin-api-key': 'test-admin-key' })), ServiceUnavailableException);
});