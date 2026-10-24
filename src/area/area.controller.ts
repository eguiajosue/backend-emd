import {
  Controller,
  Get,
  ParseBoolPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { AccessTokenPayload } from 'src/auth/auth.service';
import { isFullVisibilityRole } from 'src/order/role-stage-mapping';
import { AreaService } from './area.service';

@ApiTags('areas')
@ApiBearerAuth()
@Controller('areas')
export class AreaController {
  constructor(private readonly areaService: AreaService) {}

  /**
   * Catálogo de áreas (nombre, ícono, color y comportamiento). Lo necesita
   * cualquier sesión para mostrar etiquetas, así que basta con estar
   * autenticado. `includeInactive=true` (sólo administración y Recepción)
   * suma las desactivadas, para mostrar el área de pedidos viejos.
   */
  @UseGuards(AuthGuard)
  @Get()
  findAll(
    @ActiveUser() user: AccessTokenPayload,
    @Query('includeInactive', new ParseBoolPipe({ optional: true }))
    includeInactive?: boolean,
  ) {
    return this.areaService.findAll({
      includeInactive: !!includeInactive && isFullVisibilityRole(user.roles),
    });
  }
}
