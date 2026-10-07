import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';
import { BranchService } from './branch.service';
import { BranchLogoVariant, ParseBranchLogoVariantPipe } from './branch-logo';
import {
  CreateBranchDto,
  CreateBranchEmployeeDto,
  SetBranchLogoDto,
  UpdateBranchDto,
  UpdateBranchEmployeeDto,
} from './dto/branch.dto';

/**
 * Sucursales y sus empleados. Administrar = admin/superuser (Usuarios).
 * Recepción lee el listado para el filtro "Sucursal" de Pedidos. La cuenta
 * de sucursal sólo lee lo suyo (`GET /branches/me`). Los logos de cada
 * sucursal (variantes `onLight`/`onDark`) los sube admin/superuser y los lee
 * cualquier usuario autenticado (`GET /branches/logos`).
 */
@ApiTags('branches')
@Controller('branches')
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  // Definidos antes de las rutas con ':id' para que 'me' y 'logos' no se
  // interpreten como un id.
  @Auth(Role.SUCURSAL)
  @Get('me')
  findMine(@ActiveUser() user: AccessTokenPayload) {
    return this.branchService.findMine(user.sub);
  }

  /**
   * Logos (data URLs) de las sucursales activas. Lo leen TODOS los roles
   * porque lo necesitan las tarjetas de producción y el Modo TV. Express
   * agrega el ETag; `max-age` evita pedirlo en cada pantalla.
   */
  @Auth(...Object.values(Role))
  @Header('Cache-Control', 'private, max-age=300')
  @Get('logos')
  findLogos() {
    return this.branchService.findLogos();
  }

  @Auth(Role.ADMIN, Role.SUPERUSER, Role.RECEPCION)
  @Get()
  findAll() {
    return this.branchService.findAll();
  }

  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Post()
  create(@Body() dto: CreateBranchDto) {
    return this.branchService.create(dto);
  }

  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateBranchDto) {
    return this.branchService.update(id, dto);
  }

  // Sube una imagen de hasta 400 KB: throttle más estricto que el default
  // global, igual que las demás subidas de archivos.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Put(':id/logo/:variant')
  setLogo(
    @Param('id', ParseIntPipe) id: number,
    @Param('variant', new ParseBranchLogoVariantPipe())
    variant: BranchLogoVariant,
    @Body() dto: SetBranchLogoDto,
  ) {
    return this.branchService.setLogo(id, variant, dto);
  }

  @Auth(Role.ADMIN, Role.SUPERUSER)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id/logo/:variant')
  removeLogo(
    @Param('id', ParseIntPipe) id: number,
    @Param('variant', new ParseBranchLogoVariantPipe())
    variant: BranchLogoVariant,
  ) {
    return this.branchService.removeLogo(id, variant);
  }

  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Get(':id/employees')
  findEmployees(@Param('id', ParseIntPipe) id: number) {
    return this.branchService.findEmployees(id);
  }

  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Post(':id/employees')
  createEmployee(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateBranchEmployeeDto,
  ) {
    return this.branchService.createEmployee(id, dto);
  }

  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Patch(':id/employees/:employeeId')
  updateEmployee(
    @Param('id', ParseIntPipe) id: number,
    @Param('employeeId', ParseIntPipe) employeeId: number,
    @Body() dto: UpdateBranchEmployeeDto,
  ) {
    return this.branchService.updateEmployee(id, employeeId, dto);
  }
}
