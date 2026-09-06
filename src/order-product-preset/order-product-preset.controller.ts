import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { OrderProductPresetService } from './order-product-preset.service';
import { Auth } from 'src/common/decorators/auth.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { ApiTags } from '@nestjs/swagger';
import {
  CacheTtl,
  InMemoryCacheInterceptor,
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

  @Get()
  @UseInterceptors(InMemoryCacheInterceptor)
  @CacheTtl(ORDER_PRODUCT_PRESET_CACHE_TTL_MS)
  findAll() {
    return this.orderProductPresetService.findAll();
  }
}
