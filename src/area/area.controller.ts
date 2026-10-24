import {
  Body,
  Controller,
  Get,
  Param,
  ParseBoolPipe,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';
import { isFullVisibilityRole } from 'src/order/role-stage-mapping';
import { AreaService } from './area.service';
import { AreaAdminService } from './area-admin.service';
import {
  CreateAreaDto,
  SetAreaFieldsDto,
  SetAreaMachinesDto,
  SetAreaStagesDto,
} from './dto/create-area.dto';
import { UpdateAreaDto } from './dto/update-area.dto';

@ApiTags('areas')
@ApiBearerAuth()
@Controller('areas')
export class AreaController {
  constructor(
    private readonly areaService: AreaService,
    private readonly areaAdminService: AreaAdminService,
  ) {}

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

  /** Panel de administración: todas las áreas con usuarios y trabajo abierto. */
  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Get('overview')
  overview() {
    return this.areaAdminService.overview();
  }

  /** Alta de un área (wizard). */
  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Post()
  create(@Body() dto: CreateAreaDto, @ActiveUser() user: AccessTokenPayload) {
    return this.areaAdminService.create(dto, user.sub);
  }

  /** Edición y (des)activación; el slug no cambia. */
  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateAreaDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.areaAdminService.update(id, dto, user.sub);
  }

  /** Reemplaza las etapas previas a producción del área (el orden es el de la lista). */
  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Put(':id/stages')
  setStages(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetAreaStagesDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.areaAdminService.setStages(id, dto, user.sub);
  }

  /** Reemplaza las máquinas o equipos del área. */
  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Put(':id/machines')
  setMachines(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetAreaMachinesDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.areaAdminService.setMachines(id, dto, user.sub);
  }

  /** Reemplaza los datos propios que se capturan en cada tarea del área. */
  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Put(':id/fields')
  setFields(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetAreaFieldsDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.areaAdminService.setFields(id, dto, user.sub);
  }
}
