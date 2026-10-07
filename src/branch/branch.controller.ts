import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';
import { BranchService } from './branch.service';
import {
  CreateBranchDto,
  CreateBranchEmployeeDto,
  UpdateBranchDto,
  UpdateBranchEmployeeDto,
} from './dto/branch.dto';

/**
 * Sucursales y sus empleados. Administrar = admin/superuser (Usuarios).
 * Recepción lee el listado para el filtro "Sucursal" de Pedidos. La cuenta
 * de sucursal sólo lee lo suyo (`GET /branches/me`).
 */
@ApiTags('branches')
@Controller('branches')
export class BranchController {
  constructor(private readonly branchService: BranchService) {}

  // Definido antes de ':id' para que 'me' no se interprete como un id.
  @Auth(Role.SUCURSAL)
  @Get('me')
  findMine(@ActiveUser() user: AccessTokenPayload) {
    return this.branchService.findMine(user.sub);
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
