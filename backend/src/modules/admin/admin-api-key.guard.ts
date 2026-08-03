import { CanActivate, ExecutionContext, ForbiddenException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';

@Injectable()
export class AdminApiKeyGuard implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
        const configuredKey = process.env.ADMIN_API_KEY;
        if (!configuredKey) throw new ServiceUnavailableException('Admin API is not configured.');
        const request = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
        const provided = request.headers['x-admin-api-key'];
        const value = Array.isArray(provided) ? provided[0] : provided;
        if (!value) throw new ForbiddenException('Administrator access is required.');
        const providedBytes = Buffer.from(value);
        const configuredBytes = Buffer.from(configuredKey);
        if (providedBytes.length !== configuredBytes.length || !timingSafeEqual(providedBytes, configuredBytes)) {
            throw new ForbiddenException('Administrator access is required.');
        }
        return true;
    }
}
