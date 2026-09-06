import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseInterceptors,
} from '@nestjs/common';
import { StatusService } from './status.service';
import { CreateStatusDto } from './dto/create-status.dto';
import { UpdateStatusDto } from './dto/update-status.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ORDER_VIEWING_ROLES } from 'src/common/constants/order-viewing-roles';
import { Role } from 'src/common/enums/roles.enum';
import { ApiTags } from '@nestjs/swagger';
import {
  CacheTtl,
  InMemoryCacheInterceptor,
} from 'src/common/interceptors/in-memory-cache.interceptor';

/** Catálogo de estados: cambia rarísima vez, se cachea 5 minutos. */
const STATUS_CACHE_TTL_MS = 5 * 60 * 1000;

@Auth(Role.SUPERUSER)
@ApiTags('status')
@Controller('status')
export class StatusController {
  constructor(private readonly statusService: StatusService) {}

  @Post()
  create(@Body() createStatusDto: CreateStatusDto) {
    return this.statusService.create(createStatusDto);
  }

  @Auth(...ORDER_VIEWING_ROLES)
  @Get()
  @UseInterceptors(InMemoryCacheInterceptor)
  @CacheTtl(STATUS_CACHE_TTL_MS)
  findAll() {
    return this.statusService.findAll();
  }

  @Auth(...ORDER_VIEWING_ROLES)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.statusService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateStatusDto: UpdateStatusDto) {
    return this.statusService.update(+id, updateStatusDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.statusService.remove(+id);
  }
}
