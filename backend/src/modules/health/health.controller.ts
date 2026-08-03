import { Controller, Get, HttpCode, HttpStatus, ServiceUnavailableException } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Controller('health')
export class HealthController {
    constructor(private readonly database: DatabaseService) {}
    @Get() getHealth() { return { data: { status: 'ok' } }; }
    @Get('ready') @HttpCode(HttpStatus.OK)
    async getReadiness() { const ready = await this.database.isReady(); if (!ready) throw new ServiceUnavailableException('Required database dependencies are not ready.'); return { data: { status: 'ok' } }; }
}
