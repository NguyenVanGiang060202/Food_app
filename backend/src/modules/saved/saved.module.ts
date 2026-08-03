import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SavedController } from './saved.controller';
import { SavedRepository } from './saved.repository';
@Module({ imports: [AuthModule], controllers: [SavedController], providers: [SavedRepository] })
export class SavedModule {}