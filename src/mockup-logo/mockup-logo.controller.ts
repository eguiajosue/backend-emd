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
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';
import {
  CreateMockupLogoDto,
  RenameMockupLogoDto,
} from './dto/mockup-logo.dto';
import { MockupLogoService } from './mockup-logo.service';

/**
 * Biblioteca de logos del creador de mockups, compartida por la empresa.
 * Sólo la ve y la administra quien arma mockups con el cliente: Recepción,
 * admin y superuser (también para leer).
 */
@ApiTags('mockup-logos')
@Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
@Controller('mockup-logos')
export class MockupLogoController {
  constructor(private readonly mockupLogoService: MockupLogoService) {}

  @Get()
  findAll() {
    return this.mockupLogoService.findAll();
  }

  @Get(':id/image')
  findImage(@Param('id', ParseIntPipe) id: number) {
    return this.mockupLogoService.findImage(id);
  }

  // Sube una imagen de hasta 2MB: throttle más estricto que el default
  // global, igual que las demás subidas de archivos.
  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Post()
  create(
    @Body() dto: CreateMockupLogoDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.mockupLogoService.create(dto, user.sub);
  }

  @Patch(':id')
  rename(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: RenameMockupLogoDto,
  ) {
    return this.mockupLogoService.rename(id, dto);
  }

  // Sin cuerpo y sin throttle propio: se llama cada vez que se agrega el
  // logo a un mockup (queda bajo el límite global).
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post(':id/use')
  markUsed(@Param('id', ParseIntPipe) id: number) {
    return this.mockupLogoService.markUsed(id);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.mockupLogoService.remove(id);
  }
}
