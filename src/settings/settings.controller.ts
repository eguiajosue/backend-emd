import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AuthGuard } from 'src/common/guards/auth.guard';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  // Lectura abierta a cualquier usuario autenticado: el frontend la necesita
  // para calcular del lado del cliente cuándo ocultar un pedido entregado.
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get()
  findOne() {
    return this.settingsService.findOne();
  }

  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Patch()
  update(@Body() updateSettingsDto: UpdateSettingsDto) {
    return this.settingsService.update(updateSettingsDto);
  }
}
