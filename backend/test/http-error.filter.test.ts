import assert from 'node:assert/strict';
import test from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { DatabaseUnavailableException } from '../src/common/database-unavailable.exception';
import { HttpErrorFilter } from '../src/common/http-error.filter';

function createHost(headers: Record<string, string | string[] | undefined>) {
    let statusCode: number | undefined;
    let body: unknown;
    let responseRequestId: string | undefined;
    const response = {
        header: (_name: string, value: string) => { responseRequestId = value; },
        status: (code: number) => ({ json: (value: unknown) => { statusCode = code; body = value; } }),
    };
    return {
        host: {
            switchToHttp: () => ({
                getResponse: () => response,
                getRequest: () => ({ headers }),
            }),
        } as never,
        read: () => ({ statusCode, body, responseRequestId }),
    };
}

test('preserves structured error and adds request id', () => {
    const fixture = createHost({ 'x-request-id': ['req-from-proxy', 'ignored'] });

    new HttpErrorFilter().catch(new DatabaseUnavailableException(), fixture.host);

    assert.equal(fixture.read().statusCode, 503);
    assert.equal(fixture.read().responseRequestId, 'req-from-proxy');
    assert.deepEqual(fixture.read().body, {
        error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'The restaurant catalog is temporarily unavailable.',
            requestId: 'req-from-proxy',
        },
    });
});

test('normalizes unstructured validation errors', () => {
    const fixture = createHost({});

    new HttpErrorFilter().catch(new BadRequestException({ message: ['query is required', 'query must be a string'] }), fixture.host);

    assert.equal(fixture.read().statusCode, 400);
    assert.match(String((fixture.read().body as { error: { requestId: string } }).error.requestId), /^req_/);
    assert.deepEqual((fixture.read().body as { error: { code: string; message: string } }).error, {
        code: 'VALIDATION_ERROR',
        message: 'query is required; query must be a string',
        requestId: (fixture.read().body as { error: { requestId: string } }).error.requestId,
    });
});