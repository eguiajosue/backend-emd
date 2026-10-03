import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { ORDER_VIEWING_ROLES } from 'src/common/constants/order-viewing-roles';
import { AccessTokenPayload } from 'src/auth/auth.service';
import { InventoryService } from './inventory.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { CreateInventoryMovementDto } from './dto/create-inventory-movement.dto';
import {
  InventoryAreaQueryDto,
  InventoryMovementsQueryDto,
} from './dto/inventory-query.dto';

/**
 * Inventario por departamento. Cualquier rol del taller entra, pero el
 * servicio recorta por área: cada departamento ve y mueve sólo lo suyo
 * (admin/superuser/recepción ven todo). Ver InventoryService.
 */
@ApiTags('inventory')
@Auth(...ORDER_VIEWING_ROLES)
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  /** Departamentos que el usuario puede gestionar (para armar las pestañas). */
  @Get('areas')
  areas(@ActiveUser() user: AccessTokenPayload) {
    return this.inventoryService.areasFor(user.roles);
  }

  @Get()
  findAll(
    @Query() query: InventoryAreaQueryDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.findAll(user, query.area);
  }

  /** Últimos movimientos (kardex) de los departamentos visibles. */
  @Get('movements')
  movements(
    @Query() query: InventoryMovementsQueryDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.findMovements(user, query);
  }

  @Get('export')
  async export(
    @Query() query: InventoryAreaQueryDto,
    @ActiveUser() user: AccessTokenPayload,
    @Res() res: Response,
  ) {
    const csv = await this.inventoryService.exportCsv(user, query.area);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="inventario${query.area ? `-${query.area}` : ''}.csv"`,
    );
    res.send(csv);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.findOne(id, user);
  }

  @Get(':id/movements')
  itemMovements(
    @Param('id', ParseIntPipe) id: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.findMovements(user, {
      itemId: id,
      limit: 500,
    });
  }

  @Post()
  create(
    @Body() dto: CreateInventoryItemDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.create(dto, user);
  }

  @Post(':id/movements')
  registerMovement(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateInventoryMovementDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.registerMovement(id, dto, user);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInventoryItemDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.update(id, dto, user);
  }

  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.remove(id, user);
  }
}
