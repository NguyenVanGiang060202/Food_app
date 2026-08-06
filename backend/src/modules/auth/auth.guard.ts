import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthService } from './auth.service';

interface AuthRequest {
  headers: { authorization?: string; cookie?: string };
  user?: unknown;
}

const SESSION_COOKIE = 'food-discovery-session';

function readSessionCookie(header: string | undefined): string | undefined {
  const value = header
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE}=`));
  if (!value) return undefined;
  const token = value.slice(SESSION_COOKIE.length + 1);
  try {
    return decodeURIComponent(token);
  } catch {
    return undefined;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const token =
      request.headers.authorization?.replace(/^Bearer\s+/i, '') ||
      readSessionCookie(request.headers.cookie);
    if (!token) throw new UnauthorizedException('Bạn cần đăng nhập để thực hiện thao tác này.');
    request.user = this.auth.verifyToken(token);
    return true;
  }
}
