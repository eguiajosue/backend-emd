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
import { Roles } from 'src/common/decorators/roles.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';
import { InventoryService } from './inventory.service';
import { CreateInventoryItemDto } from './dto/create-inventory-item.dto';
import { UpdateInventoryItemDto } from './dto/update-inventory-item.dto';
import { CreateInventoryMovementDto } from './dto/create-inventory-movement.dto';
import {
  InventoryAreaQueryDto,
  InventoryMovementsQueryDto,
} from './dto/inventory-query.dto';
import {
  CreateRestockRequestDto,
  RestockRequestsQueryDto,
  UpdateRestockRequestStatusDto,
} from './dto/restock-request.dto';

/** Quienes gestionan todo el inventario (altas, ajustes, bitácora, reabasto). */
export const INVENTORY_MANAGER_ROLES = [
  Role.RECEPCION,
  Role.ADMIN,
  Role.SUPERUSER,
] as const;

/** Áreas de producción con acceso a SU inventario (Diseño no lleva insumos aquí). */
export const INVENTORY_AREA_ROLES = [
  Role.TALLER,
  Role.DTF,
  Role.BORDADO,
  Role.LASER,
  Role.IMPRESIONES,
] as const;

/**
 * Inventario por departamento. Recepción, admin y superuser lo gestionan
 * todo. Las áreas de producción entran a SU inventario: ven sus artículos,
 * registran entradas y consumos y avisan reabasto; el servicio filtra cada
 * consulta y rechaza artículos de otras áreas (403 por id, 404 por código).
 * Las rutas marcadas con `@Roles(...INVENTORY_MANAGER_ROLES)` son sólo de
 * gestión.
 */
@ApiTags('inventory')
@Auth(...INVENTORY_MANAGER_ROLES, ...INVENTORY_AREA_ROLES)
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

  /** Bitácora global: filtrable por área, usuario, artículo, tipo y fechas. */
  @Roles(...INVENTORY_MANAGER_ROLES)
  @Get('movements')
  movements(
    @Query() query: InventoryMovementsQueryDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.findMovements(user, query);
  }

  @Roles(...INVENTORY_MANAGER_ROLES)
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

  /** Solicitudes de reabasto: Recepción ve todas, cada área las suyas. */
  @Get('restock-requests')
  restockRequests(
    @Query() query: RestockRequestsQueryDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.findRestockRequests(user, query);
  }

  /** Conteo para el badge de "Solicitudes de reabasto". */
  @Get('restock-requests/count')
  restockCount(@ActiveUser() user: AccessTokenPayload) {
    return this.inventoryService.restockPendingCount(user);
  }

  /** Avisar que algo se acabó / requiere reabasto (cualquier área con acceso). */
  @Post('restock-requests')
  createRestockRequest(
    @Body() dto: CreateRestockRequestDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.createRestockRequest(dto, user);
  }

  @Roles(...INVENTORY_MANAGER_ROLES)
  @Patch('restock-requests/:id')
  updateRestockStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRestockRequestStatusDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.updateRestockStatus(id, dto, user);
  }

  /**
   * Artículo por código de barras (escaneo). El código va URL-encoded
   * (encodeURIComponent): Code 128 admite "/", "%", "#", "?"...
   * 404 si no existe o es de un departamento que el usuario no ve.
   */
  @Get('items/by-barcode/:code')
  findByBarcode(
    @Param('code') code: string,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.findByBarcode(code, user);
  }

  /**
   * Escaneo en modo Entrada/Salida en una sola petición: ubica el artículo y
   * registra el movimiento igual que `POST /inventory/:id/movements`.
   */
  @Post('items/by-barcode/:code/movements')
  registerMovementByBarcode(
    @Param('code') code: string,
    @Body() dto: CreateInventoryMovementDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.registerMovementByBarcode(code, dto, user);
  }

  @Get(':id')
  findOne(
    @Param('id', ParseIntPipe) id: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.findOne(id, user);
  }

  /** Historial (bitácora) de un artículo. */
  @Roles(...INVENTORY_MANAGER_ROLES)
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

  @Roles(...INVENTORY_MANAGER_ROLES)
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

  @Roles(...INVENTORY_MANAGER_ROLES)
  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateInventoryItemDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.update(id, dto, user);
  }

  @Roles(...INVENTORY_MANAGER_ROLES)
  @Delete(':id')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.inventoryService.remove(id, user);
  }
}
