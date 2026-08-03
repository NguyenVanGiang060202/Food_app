import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';

type HttpResponse = {
    header(name: string, value: string): void;
    status(code: number): { json(body: unknown): void };
};

type HttpRequest = {
    headers: Record<string, string | string[] | undefined>;
};

@Catch()
export class HttpErrorFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost): void {
        const ctx = host.switchToHttp();
        const response = ctx.getResponse<HttpResponse>();
        const request = ctx.getRequest<HttpRequest>();
        const requestIdHeader = request.headers['x-request-id'];
        const requestId = (Array.isArray(requestIdHeader) ? requestIdHeader[0] : requestIdHeader) ?? `req_${Date.now().toString(36)}`;
        response.header('x-request-id', requestId);
        if (exception instanceof HttpException) {
            const status = exception.getStatus(); const payload = exception.getResponse();
            const body = typeof payload === 'object' && payload !== null ? payload as Record<string, unknown> : { message: String(payload) };
            if (typeof body.error === 'object' && body.error !== null) {
                response.status(status).json({ ...body, error: { ...(body.error as Record<string, unknown>), requestId } });
                return;
            }
            const messages = Array.isArray(body.message) ? body.message : [body.message ?? 'Request failed.'];
            response.status(status).json({ error: { code: status === HttpStatus.BAD_REQUEST ? 'VALIDATION_ERROR' : status === HttpStatus.UNAUTHORIZED ? 'UNAUTHENTICATED' : status === HttpStatus.FORBIDDEN ? 'FORBIDDEN' : status === HttpStatus.NOT_FOUND ? 'NOT_FOUND' : status === HttpStatus.CONFLICT ? 'CONFLICT' : status === HttpStatus.TOO_MANY_REQUESTS ? 'RATE_LIMITED' : status === HttpStatus.SERVICE_UNAVAILABLE ? 'SERVICE_UNAVAILABLE' : 'INTERNAL_ERROR', message: messages.join('; '), requestId } }); return;
        }
        response.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.', requestId } });
    }
}





