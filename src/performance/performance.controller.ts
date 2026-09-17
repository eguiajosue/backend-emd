import { Controller, Get } from '@nestjs/common';
import { PerformanceService } from './performance.service';
import { Auth } from 'src/common/decorators/auth.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { ApiTags } from '@nestjs/swagger';
import { getRequestLatencySummary } from 'src/common/metrics/request-latency.tracker';

@ApiTags('performance')
@Auth(Role.ADMIN, Role.SUPERUSER)
@Controller('performance')
export class PerformanceController {
  constructor(private readonly performanceService: PerformanceService) {}

  @Get('summary')
  getSummary() {
    return this.performanceService.getSummary();
  }

  /**
   * p50/p90/p95/p99 de latencia HTTP sobre las últimas ~500 requests (ver
   * `request-latency.tracker.ts`). Guía de rendimiento §23-24: priorizar p95
   * sobre el promedio antes de optimizar por intuición.
   */
  @Get('latency')
  getLatency() {
    return getRequestLatencySummary();
  }
}
