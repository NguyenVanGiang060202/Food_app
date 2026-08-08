import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { HttpErrorFilter } from './common/http-error.filter';
import {
  assertProductionOrigins,
  assertProductionSecrets,
  parseAllowedOrigins,
  parsePositiveInteger,
  rateLimit,
  requestSizeLimit,
  resolveFrontendOrigin,
  securityHeaders,
} from './common/http-security';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api/v1');
  const allowedOrigins = parseAllowedOrigins(process.env.APP_ORIGINS ?? process.env.APP_ORIGIN);
  assertProductionOrigins(allowedOrigins);
  assertProductionSecrets({
    authSecret: process.env.AUTH_SECRET,
    adminApiKey: process.env.ADMIN_API_KEY,
  });
  resolveFrontendOrigin(process.env.APP_ORIGIN, allowedOrigins);
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.use(securityHeaders());
  const requestLimitBytes = parsePositiveInteger(process.env.REQUEST_BODY_LIMIT_BYTES, 1_048_576);
  const rateLimitWindowMs = parsePositiveInteger(process.env.RATE_LIMIT_WINDOW_MS, 60_000);
  const rateLimitMax = parsePositiveInteger(process.env.RATE_LIMIT_MAX, 120);
  app.use(requestSizeLimit(requestLimitBytes));
  app.use(require('express').json({ limit: requestLimitBytes }));
  app.use(rateLimit({ windowMs: rateLimitWindowMs, max: rateLimitMax }));
  app.useGlobalFilters(new HttpErrorFilter());
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  await app.listen(Number(process.env.PORT ?? 3000));
}
void bootstrap();
