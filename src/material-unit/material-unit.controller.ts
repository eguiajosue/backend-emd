import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { MaterialUnitService } from './material-unit.service';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ORDER_VIEWING_ROLES } from 'src/common/constants/order-viewing-roles';
import { ApiTags } from '@nestjs/swagger';
import {
  CacheTtl,
  InMemoryCacheInterceptor,
} from 'src/common/interceptors/in-memory-cache.interceptor';

/** Catálogo de unidades de medida: cambia poco, se cachea 5 minutos. */
const MATERIAL_UNIT_CACHE_TTL_MS = 5 * 60 * 1000;

@ApiTags('material-units')
@Auth(...ORDER_VIEWING_ROLES)
@Controller('material-units')
export class MaterialUnitController {
  constructor(private readonly materialUnitService: MaterialUnitService) {}

  @Get()
  @UseInterceptors(InMemoryCacheInterceptor)
  @CacheTtl(MATERIAL_UNIT_CACHE_TTL_MS)
  findAll() {
    return this.materialUnitService.findAll();
  }
}
