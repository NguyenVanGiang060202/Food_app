import { Body, Controller, Get, Patch, Post, Req, UseGuards, Query, Res } from '@nestjs/common';
import { RequestPasswordResetDto, ResetPasswordDto, SignInDto, SignUpDto } from './auth.dto';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { UpdatePreferencesDto } from './preferences.dto';
import { parseAllowedOrigins, resolveFrontendOrigin } from '../../common/http-security';

interface AuthenticatedRequest { user?: AuthUser; }
interface HttpResponse {
    setHeader(name: string, value: string): void;
    redirect(url: string): unknown;
}

const SESSION_COOKIE = 'food-discovery-session';

function setSessionCookie(response: HttpResponse, token: string): void {
    const secure = (process.env.NODE_ENV ?? 'development') === 'production';
    response.setHeader('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax${secure ? '; Secure' : ''}`);
}

function clearSessionCookie(response: HttpResponse): void {
    response.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax${(process.env.NODE_ENV ?? 'development') === 'production' ? '; Secure' : ''}`);
}

@Controller('auth')
export class AuthController {
    constructor(private readonly auth: AuthService) {}
    @Post('signup') signup(@Body() body: SignUpDto) { return this.auth.signUp(body.email, body.password, body.confirmPassword, body.displayName); }
    @Post('signin') async signin(@Body() body: SignInDto, @Res({ passthrough: true }) response: HttpResponse) {
        const result = await this.auth.signIn(body.email, body.password);
        setSessionCookie(response, result.token);
        return result;
    }
    @Post('logout') logout(@Res({ passthrough: true }) response: HttpResponse) {
        clearSessionCookie(response);
        return { loggedOut: true };
    }
    @Post('request-password-reset') requestPasswordReset(@Body() body: RequestPasswordResetDto) { return this.auth.requestPasswordReset(body.email); }
    @Post('reset-password') resetPassword(@Body() body: ResetPasswordDto) { return this.auth.resetPassword(body.token, body.password, body.confirmPassword); }
    @Get('google') google() { return this.auth.googleAuthorizationUrl(); }
    @Get('google/callback') async googleCallback(@Query('code') code: string | undefined, @Query('error') error: string | undefined, @Res() response: HttpResponse) {
        const allowedOrigins = parseAllowedOrigins(process.env.APP_ORIGINS ?? process.env.APP_ORIGIN);
        const origin = resolveFrontendOrigin(process.env.APP_ORIGIN, allowedOrigins);
        if (error || !code) return response.redirect(`${origin}/auth?oauthError=google`);
        try {
            const result = await this.auth.signInWithGoogle(code);
            setSessionCookie(response, result.token);
            return response.redirect(`${origin}/auth?oauthSuccess=google`);
        } catch { return response.redirect(`${origin}/auth?oauthError=google`); }
    }
    @Get('me') @UseGuards(AuthGuard) me(@Req() request: AuthenticatedRequest) { return { user: request.user }; }
    @Get('verify-email') verifyEmail(@Query('token') token?: string) { return this.auth.verifyEmail(token ?? ''); }
}

@Controller('users')
export class UsersController {
    constructor(private readonly auth: AuthService) {}
    @Get('me/preferences') @UseGuards(AuthGuard) getPreferences(@Req() request: AuthenticatedRequest) { return this.auth.getPreferences(request.user!.id).then(data => ({ data })); }
    @Patch('me/preferences') @UseGuards(AuthGuard) updatePreferences(@Req() request: AuthenticatedRequest, @Body() body: UpdatePreferencesDto) { return this.auth.updatePreferences(request.user!.id, body).then(data => ({ data })); }
}