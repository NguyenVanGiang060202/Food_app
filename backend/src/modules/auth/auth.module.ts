import { Module } from '@nestjs/common';
import { AuthController, UsersController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { EmailService } from './email.service';
@Module({ controllers: [AuthController, UsersController], providers: [AuthService, AuthGuard, EmailService], exports: [AuthService, AuthGuard] })
export class AuthModule {}