export function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? 'http://localhost:5173,http://localhost:5174')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function assertProductionOrigins(
  origins: string[],
  nodeEnv = process.env.NODE_ENV ?? 'development',
): void {
  if (nodeEnv !== 'production') return;
  if (origins.length === 0 || origins.some((origin) => /localhost|127\.0\.0\.1/i.test(origin))) {
    throw new Error('Production requires explicit non-local CORS origins.');
  }
}

export function assertProductionSecrets(
  config: { authSecret?: string; adminApiKey?: string },
  nodeEnv = process.env.NODE_ENV ?? 'development',
): void {
  if (nodeEnv !== 'production') return;
  const authSecret = config.authSecret?.trim();
  const adminApiKey = config.adminApiKey?.trim();
  if (
    !authSecret ||
    authSecret === 'local-development-secret-change-me' ||
    authSecret.length < 32
  ) {
    throw new Error('Production requires a strong AUTH_SECRET.');
  }
  if (!adminApiKey || adminApiKey.length < 32) {
    throw new Error('Production requires a strong ADMIN_API_KEY.');
  }
}

export function resolveFrontendOrigin(
  configuredOrigin: string | undefined,
  allowedOrigins: string[],
  nodeEnv = process.env.NODE_ENV ?? 'development',
): string {
  const origin = (
    configuredOrigin ?? (nodeEnv === 'production' ? '' : 'http://localhost:5173')
  ).trim();
  if (!origin) throw new Error('Production requires an explicit APP_ORIGIN.');
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error('APP_ORIGIN must be a valid absolute URL.');
  }
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('APP_ORIGIN must contain only an HTTP(S) origin.');
  }
  const normalized = parsed.origin;
  if (nodeEnv === 'production' && !allowedOrigins.includes(normalized)) {
    throw new Error('APP_ORIGIN must be included in the configured CORS origins.');
  }
  return normalized;
}

type SecurityResponse = {
  removeHeader?(name: string): void;
  disable?(name: string): void;
  setHeader(name: string, value: string): void;
};

type SecurityRequest = { secure?: boolean };

type RateLimitRequest = {
  ip?: string;
  socket?: { remoteAddress?: string };
  path?: string;
  url?: string;
  method?: string;
};

type RateLimitResponse = {
  setHeader(name: string, value: string): void;
  statusCode: number;
  end(body?: string): void;
};

type SizeLimitRequest = { headers?: { 'content-length'?: string } };

type SizeLimitResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
};

type RateLimitOptions = {
  windowMs: number;
  max: number;
  now?: () => number;
  key?: (request: RateLimitRequest) => string;
};

type RateLimitBucket = { count: number; resetAt: number };

export function parsePositiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function requestSizeLimit(maxBytes: number) {
  return (request: SizeLimitRequest, response: SizeLimitResponse, next: () => void): void => {
    const rawLength = request.headers?.['content-length'];
    const contentLength = rawLength === undefined ? 0 : Number(rawLength);
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      response.statusCode = 413;
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ statusCode: 413, message: 'Request entity too large' }));
      return;
    }
    next();
  };
}

export function rateLimit(options: RateLimitOptions) {
  const buckets = new Map<string, RateLimitBucket>();
  const now = options.now ?? (() => Date.now());
  const keyFor =
    options.key ??
    ((request: RateLimitRequest) => {
      const address = request.ip ?? request.socket?.remoteAddress ?? 'unknown';
      return `${address}:${request.method ?? 'GET'}:${request.path ?? request.url ?? '/'}`;
    });

  return (request: RateLimitRequest, response: RateLimitResponse, next: () => void): void => {
    const current = now();
    const key = keyFor(request);
    const existing = buckets.get(key);
    const bucket =
      !existing || existing.resetAt <= current
        ? { count: 0, resetAt: current + options.windowMs }
        : existing;
    bucket.count += 1;
    buckets.set(key, bucket);

    const remaining = Math.max(0, options.max - bucket.count);
    response.setHeader('X-RateLimit-Limit', String(options.max));
    response.setHeader('X-RateLimit-Remaining', String(remaining));
    response.setHeader('X-RateLimit-Reset', String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > options.max) {
      response.statusCode = 429;
      response.setHeader(
        'Retry-After',
        String(Math.max(1, Math.ceil((bucket.resetAt - current) / 1000))),
      );
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ statusCode: 429, message: 'Too many requests' }));
      return;
    }
    next();
  };
}

export function securityHeaders(nodeEnv = process.env.NODE_ENV ?? 'development') {
  return (request: SecurityRequest, response: SecurityResponse, next: () => void): void => {
    if (response.disable) response.disable('x-powered-by');
    else response.removeHeader?.('X-Powered-By');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('Permissions-Policy', 'geolocation=(self), camera=(), microphone=()');
    response.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'",
    );
    if (nodeEnv === 'production' && request.secure) {
      response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
    next();
  };
}
