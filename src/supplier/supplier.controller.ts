import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SupplierService } from './supplier.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { ORDER_VIEWING_ROLES } from 'src/common/constants/order-viewing-roles';

/**
 * Catálogo de proveedores de materiales/insumos. Alta/edición restringida
 * a quien gestiona el catálogo (mismo criterio que Empresas); lectura
 * abierta a todo rol que ve pedidos, porque la hoja de materiales de un
 * pedido muestra el proveedor y su ubicación.
 */
@ApiTags('suppliers')
@Controller('suppliers')
export class SupplierController {
  constructor(private readonly supplierService: SupplierService) {}

  @Post()
  @Auth(Role.ADMIN, Role.SUPERUSER, Role.RECEPCION)
  create(@Body() dto: CreateSupplierDto) {
    return this.supplierService.create(dto);
  }

  @Get()
  @Auth(...ORDER_VIEWING_ROLES)
  findAll() {
    return this.supplierService.findAll();
  }

  @Get(':id')
  @Auth(...ORDER_VIEWING_ROLES)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.supplierService.findOne(id);
  }

  @Patch(':id')
  @Auth(Role.ADMIN, Role.SUPERUSER, Role.RECEPCION)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateSupplierDto,
  ) {
    return this.supplierService.update(id, dto);
  }

  @Delete(':id')
  @Auth(Role.ADMIN, Role.SUPERUSER, Role.RECEPCION)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.supplierService.remove(id);
  }
}
