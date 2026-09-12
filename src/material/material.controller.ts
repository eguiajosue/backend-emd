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
import { MaterialService } from './material.service';
import { CreateMaterialDto } from './dto/create-material.dto';
import { UpdateMaterialDto } from './dto/update-material.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { ORDER_VIEWING_ROLES } from 'src/common/constants/order-viewing-roles';

/**
 * Catálogo de materiales/insumos de la empresa. Alta/edición restringida a
 * quien gestiona el catálogo; lectura abierta a todo rol que ve pedidos,
 * porque la hoja de materiales de un pedido se arma eligiendo de acá.
 */
@ApiTags('materials')
@Controller('materials')
export class MaterialController {
  constructor(private readonly materialService: MaterialService) {}

  @Post()
  @Auth(Role.ADMIN, Role.SUPERUSER, Role.RECEPCION)
  create(@Body() dto: CreateMaterialDto) {
    return this.materialService.create(dto);
  }

  @Get()
  @Auth(...ORDER_VIEWING_ROLES)
  findAll() {
    return this.materialService.findAll();
  }

  @Get(':id')
  @Auth(...ORDER_VIEWING_ROLES)
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.materialService.findOne(id);
  }

  @Patch(':id')
  @Auth(Role.ADMIN, Role.SUPERUSER, Role.RECEPCION)
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMaterialDto,
  ) {
    return this.materialService.update(id, dto);
  }

  @Delete(':id')
  @Auth(Role.ADMIN, Role.SUPERUSER, Role.RECEPCION)
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.materialService.remove(id);
  }
}
