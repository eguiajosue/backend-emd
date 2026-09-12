import { Controller, Get, UseInterceptors } from '@nestjs/common';
import { MaterialCategoryService } from './material-category.service';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ORDER_VIEWING_ROLES } from 'src/common/constants/order-viewing-roles';
import { ApiTags } from '@nestjs/swagger';
import {
  CacheTtl,
  InMemoryCacheInterceptor,
} from 'src/common/interceptors/in-memory-cache.interceptor';

/** Catálogo de categorías de material: cambia poco, se cachea 5 minutos. */
const MATERIAL_CATEGORY_CACHE_TTL_MS = 5 * 60 * 1000;

@ApiTags('material-categories')
@Auth(...ORDER_VIEWING_ROLES)
@Controller('material-categories')
export class MaterialCategoryController {
  constructor(
    private readonly materialCategoryService: MaterialCategoryService,
  ) {}

  @Get()
  @UseInterceptors(InMemoryCacheInterceptor)
  @CacheTtl(MATERIAL_CATEGORY_CACHE_TTL_MS)
  findAll() {
    return this.materialCategoryService.findAll();
  }
}
