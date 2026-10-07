import { Body, Controller, Get, Post, UseInterceptors } from '@nestjs/common';
import { OrderProductPresetService } from './order-product-preset.service';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ORDER_VIEWING_ROLES_WITH_BRANCH } from 'src/common/constants/order-viewing-roles';
import { Role } from 'src/common/enums/roles.enum';
import { ApiTags } from '@nestjs/swagger';
import { CreateOrderProductPresetDto } from './dto/create-order-product-preset.dto';
import {
  CacheTtl,
  InMemoryCacheInterceptor,
  invalidateControllerCache,
} from 'src/common/interceptors/in-memory-cache.interceptor';

/** Catálogo de productos frecuentes: cambia poco, se cachea 5 minutos. */
const ORDER_PRODUCT_PRESET_CACHE_TTL_MS = 5 * 60 * 1000;

@ApiTags('order-product-presets')
@Auth(Role.ADMIN, Role.SUPERUSER, Role.RECEPCION)
@Controller('order-product-presets')
export class OrderProductPresetController {
  constructor(
    private readonly orderProductPresetService: OrderProductPresetService,
  ) {}

  @Auth(...ORDER_VIEWING_ROLES_WITH_BRANCH)
  @Get()
  @UseInterceptors(InMemoryCacheInterceptor)
  @CacheTtl(ORDER_PRODUCT_PRESET_CACHE_TTL_MS)
  findAll() {
    return this.orderProductPresetService.findAll();
  }

  // Alta de un producto frecuente propio (find-or-create, idempotente). Mismos
  // roles que pueden levantar pedidos; no hay DELETE global del catálogo.
  @Auth(Role.ADMIN, Role.SUPERUSER, Role.RECEPCION, Role.SUCURSAL)
  @Post()
  async create(@Body() dto: CreateOrderProductPresetDto) {
    const preset = await this.orderProductPresetService.findOrCreate(dto.name);
    // El GET está cacheado 5 min: se invalida para que el nuevo aparezca ya.
    invalidateControllerCache(OrderProductPresetController.name);
    return preset;
  }
}
