import test from 'node:test';
import assert from 'node:assert/strict';
import { assertProductionOrigins, assertProductionSecrets, parseAllowedOrigins, parsePositiveInteger, rateLimit, requestSizeLimit, resolveFrontendOrigin, securityHeaders } from '../src/common/http-security';

test('parseAllowedOrigins trims and removes empty values', () => {
    assert.deepEqual(parseAllowedOrigins(' https://app.example , ,https://admin.example '), ['https://app.example', 'https://admin.example']);
});

test('production rejects local CORS origins', () => {
    assert.throws(() => assertProductionOrigins(['http://localhost:5173'], 'production'), /non-local CORS origins/);
    assert.doesNotThrow(() => assertProductionOrigins(['https://app.example'], 'production'));
});

test('production rejects missing, default, or weak secrets', () => {
    assert.throws(() => assertProductionSecrets({}, 'production'), /strong AUTH_SECRET/);
    assert.throws(() => assertProductionSecrets({ authSecret: 'local-development-secret-change-me', adminApiKey: 'a'.repeat(32) }, 'production'), /strong AUTH_SECRET/);
    assert.throws(() => assertProductionSecrets({ authSecret: 'a'.repeat(32), adminApiKey: 'short' }, 'production'), /strong ADMIN_API_KEY/);
    assert.doesNotThrow(() => assertProductionSecrets({ authSecret: 'a'.repeat(32), adminApiKey: 'b'.repeat(32) }, 'production'));
});

test('frontend OAuth origin must be explicit and allowlisted in production', () => {
    assert.equal(resolveFrontendOrigin(undefined, ['http://localhost:5173']), 'http://localhost:5173');
    assert.equal(resolveFrontendOrigin('https://app.example/', ['https://app.example'], 'production'), 'https://app.example');
    assert.throws(() => resolveFrontendOrigin(undefined, ['https://app.example'], 'production'), /explicit APP_ORIGIN/);
    assert.throws(() => resolveFrontendOrigin('https://other.example', ['https://app.example'], 'production'), /CORS origins/);
    assert.throws(() => resolveFrontendOrigin('https://app.example/auth', ['https://app.example'], 'production'), /HTTP\(S\) origin/);
});

test('security middleware sets baseline response headers', () => {
    const headers = new Map<string, string>();
    let disabled = '';
    let called = false;
    securityHeaders('production')({ secure: true }, {
        disable: (name) => { disabled = name; },
        setHeader: (name, value) => { headers.set(name, value); },
    }, () => { called = true; });
    assert.equal(disabled, 'x-powered-by');
    assert.equal(headers.get('X-Content-Type-Options'), 'nosniff');
    assert.equal(headers.get('X-Frame-Options'), 'DENY');
    assert.equal(headers.get('Strict-Transport-Security')?.startsWith('max-age='), true);
    assert.equal(called, true);
});

test('request size middleware rejects oversized content length', () => {
    let called = false;
    let body = '';
    const response = {
        statusCode: 200,
        setHeader: () => undefined,
        end: (value?: string) => { body = value ?? ''; },
    };
    requestSizeLimit(100)({ headers: { 'content-length': '101' } }, response, () => { called = true; });
    assert.equal(response.statusCode, 413);
    assert.match(body, /Request entity too large/);
    assert.equal(called, false);
});

test('rate limiter rejects requests after the configured allowance', () => {
    let currentTime = 1_000;
    let nextCalls = 0;
    let statusCode = 200;
    const headers = new Map<string, string>();
    const limiter = rateLimit({ windowMs: 1_000, max: 2, now: () => currentTime, key: () => 'test-key' });
    const request = { method: 'GET', path: '/api/v1/search' };
    const response = {
        statusCode,
        setHeader: (name: string, value: string) => { headers.set(name, value); },
        end: () => undefined,
    };
    limiter(request, response, () => { nextCalls += 1; });
    limiter(request, response, () => { nextCalls += 1; });
    limiter(request, response, () => { nextCalls += 1; });
    statusCode = response.statusCode;
    assert.equal(nextCalls, 2);
    assert.equal(statusCode, 429);
    assert.equal(headers.get('Retry-After'), '1');
    currentTime += 1_000;
    response.statusCode = 200;
    limiter(request, response, () => { nextCalls += 1; });
    assert.equal(nextCalls, 3);
});

test('positive integer parser falls back for invalid configuration', () => {
    assert.equal(parsePositiveInteger('30', 10), 30);
    assert.equal(parsePositiveInteger('0', 10), 10);
    assert.equal(parsePositiveInteger('invalid', 10), 10);
});