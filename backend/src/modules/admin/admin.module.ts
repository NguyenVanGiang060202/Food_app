import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminApiKeyGuard } from './admin-api-key.guard';
import { AdminAuthorizationGuard } from './admin-authorization.guard';
import { AuthModule } from '../auth/auth.module';
@Module({ imports: [AuthModule], controllers: [AdminController], providers: [AdminApiKeyGuard, AdminAuthorizationGuard] })
export class AdminModule {}
