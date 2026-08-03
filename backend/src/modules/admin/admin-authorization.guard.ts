import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { AdminApiKeyGuard } from './admin-api-key.guard';

interface AdminRequest {
    headers: { authorization?: string; cookie?: string };
    user?: { role?: string };
}

const SESSION_COOKIE = 'food-discovery-session';

function hasSessionCredentials(request: AdminRequest) {
    return Boolean(request.headers.authorization) || request.headers.cookie?.split(';').some(part => part.trim().startsWith(`${SESSION_COOKIE}=`));
}

@Injectable()
export class AdminAuthorizationGuard implements CanActivate {
    constructor(private readonly authGuard: AuthGuard, private readonly apiKeyGuard: AdminApiKeyGuard) {}

    canActivate(context: ExecutionContext) {
        const request = context.switchToHttp().getRequest<AdminRequest>();
        if (!hasSessionCredentials(request)) return this.apiKeyGuard.canActivate(context);

        this.authGuard.canActivate(context);
        if (request.user?.role !== 'admin') throw new ForbiddenException('Administrator access is required.');
        return true;
    }
}