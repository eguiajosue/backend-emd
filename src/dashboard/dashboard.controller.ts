import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';
import { DashboardService } from './dashboard.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';

/** Inicio de cada rol (ver DashboardService). */
@ApiTags('dashboard')
@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  /** Control de todas las áreas: lo usa Recepción (y admin/superuser). */
  @Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Get('reception')
  reception(@Query() query: DashboardQueryDto) {
    return this.dashboardService.reception(query.dayStart);
  }

  /** Bandeja y circuito de Diseño. */
  @Auth(Role.DISENO, Role.ADMIN, Role.SUPERUSER)
  @Get('design')
  design(
    @Query() query: DashboardQueryDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.dashboardService.design(
      { userId: user.sub, roles: user.roles },
      query.dayStart,
    );
  }

  /** Trabajos de las áreas de producción del usuario. */
  @Auth(
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.LASER,
    Role.IMPRESIONES,
    Role.ADMIN,
    Role.SUPERUSER,
  )
  @Get('production')
  production(
    @Query() query: DashboardQueryDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.dashboardService.production(
      { userId: user.sub, roles: user.roles },
      query.dayStart,
    );
  }
}
