import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Auth } from 'src/common/decorators/auth.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { ClientInsightService } from './client-insight.service';

/** Lo aprendido de cada cliente: lo usa quien da de alta pedidos. */
@ApiTags('client-insights')
@Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
@Controller()
export class ClientInsightController {
  constructor(private readonly clientInsightService: ClientInsightService) {}

  @Get('clients/:clientId/insights')
  getProfile(@Param('clientId', ParseIntPipe) clientId: number) {
    return this.clientInsightService.getProfile(clientId);
  }

  @Get('client-insights/due')
  dueClients() {
    return this.clientInsightService.dueClients();
  }
}
