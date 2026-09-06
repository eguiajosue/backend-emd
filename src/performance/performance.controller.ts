import { Controller, Get } from '@nestjs/common';
import { PerformanceService } from './performance.service';
import { Auth } from 'src/common/decorators/auth.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('performance')
@Auth(Role.ADMIN, Role.SUPERUSER)
@Controller('performance')
export class PerformanceController {
  constructor(private readonly performanceService: PerformanceService) {}

  @Get('summary')
  getSummary() {
    return this.performanceService.getSummary();
  }
}
