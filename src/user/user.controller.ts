import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('users')
@Controller('users')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Auth(Role.ADMIN, Role.SUPERUSER)
  @Post()
  create(@Body() createUserDto: CreateUserDto) {
    return this.userService.create(createUserDto);
  }

  // Lectura abierta a admin/superuser/recepcion: recepción necesita listar
  // usuarios para el selector "Asignar a" al crear un pedido.
  @Auth(Role.ADMIN, Role.SUPERUSER, Role.RECEPCION)
  @Get()
  findAll() {
    return this.userService.findAll();
  }

  @Auth(Role.ADMIN, Role.SUPERUSER, Role.RECEPCION)
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
