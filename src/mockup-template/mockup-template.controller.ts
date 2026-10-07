import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Auth } from 'src/common/decorators/auth.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';
import {
  CreateMockupTemplateDto,
  RenameMockupTemplateDto,
} from './dto/mockup-template.dto';
import { MockupTemplateService } from './mockup-template.service';

/**
 * Plantillas del creador de mockups, compartidas por la empresa. Sólo las
 * ve y las administra quien arma mockups con el cliente: Recepción, admin y
 * superuser (también para leer).
 */
@ApiTags('mockup-templates')
// La sucursal usa Mockups: lee, guarda y usa; renombrar/borrar no.
@Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER, Role.SUCURSAL)
@Controller('mockup-templates')
export class MockupTemplateController {
  constructor(private readonly mockupTemplateService: MockupTemplateService) {}

  @Get()
  findAll() {
    return this.mockupTemplateService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.mockupTemplateService.findOne(id);
  }

  // Sube una configuración de hasta 8MB: throttle más estricto que el
  // default global, igual que las demás subidas de archivos.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post()
  create(
    @Body() dto: CreateMockupTemplateDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.mockupTemplateService.create(dto, user.sub);
  }

  @Roles(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Patch(':id')
  rename(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenameMockupTemplateDto,
  ) {
    return this.mockupTemplateService.rename(id, dto);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Roles(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.mockupTemplateService.remove(id);
  }
}
