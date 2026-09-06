import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateUserPreferencesDto } from './dto/update-user-preferences.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import type { AccessTokenPayload } from 'src/auth/auth.service';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

@ApiTags('users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  // Preferencias propias: cualquier usuario autenticado puede ver/actualizar
  // las suyas, sin restricción de rol. Definidas antes de ':id' para que
  // 'me' no sea interpretado como un id.
  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Get('me/preferences')
  getMyPreferences(@ActiveUser() user: AccessTokenPayload) {
    return this.userService.getPreferences(user.sub);
  }

  @ApiBearerAuth()
  @UseGuards(AuthGuard)
  @Patch('me/preferences')
  updateMyPreferences(
    @ActiveUser() user: AccessTokenPayload,
    @Body() updateUserPreferencesDto: UpdateUserPreferencesDto,
  ) {
    return this.userService.updatePreferences(
      user.sub,
      updateUserPreferencesDto,
    );
  }

  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  // Lectura abierta a todos los roles que pueden ver pedidos: recepción
  // necesita listar usuarios para el selector "Asignar a" al crear un
  // pedido, y la pantalla de "Pedidos" (también para roles operativos)
  // usa este listado para el filtro "Asignado a".
  @Auth(
    Role.ADMIN,
    Role.SUPERUSER,
    Role.RECEPCION,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.DISENO,
    Role.LASER,
    Role.IMPRESIONES,
  )
  @Get()
  findAll() {
    return this.userService.findAll();
  }

  @Auth(
    Role.ADMIN,
    Role.SUPERUSER,
    Role.RECEPCION,
    Role.TALLER,
    Role.DTF,
    Role.BORDADO,
    Role.DISENO,
    Role.LASER,
    Role.IMPRESIONES,
  )
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.userService.findOne(+id);
  }

  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto) {
    return this.userService.update(+id, updateUserDto);
  }

  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.userService.remove(+id);
  }
}
