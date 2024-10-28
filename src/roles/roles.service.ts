import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRoleDto } from './dto/update-role.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}
  create(createRoleDto: CreateRoleDto) {
    const existingRole = this.prisma.roles.findFirst({
      where: { role_name: createRoleDto.role_name },
    });

    if (existingRole) {
      throw new HttpException(
        'El rol ya existe en la base de datos',
        HttpStatus.BAD_REQUEST,
      );
    }
    return this.prisma.roles.create({
      data: { ...createRoleDto },
    });
  }

  async findAll() {
    return await this.prisma.roles.findMany();
  }

  findOne(id: string) {
    const foundRole = this.prisma.roles.findFirst({
      where: { role_id: id },
    });

    if (!foundRole) {
      throw new HttpException('El rol no existe', HttpStatus.NOT_FOUND);
    }
    return new HttpException(foundRole, HttpStatus.FOUND);
  }

  update(id: string, updateRoleDto: UpdateRoleDto) {
    const existingRole = this.prisma.roles.findFirst({
      where: { role_id: id },
    });

    if (!existingRole) {
      throw new HttpException('El rol no existe', HttpStatus.NOT_FOUND);
    }
    return this.prisma.roles.update({
      where: { role_id: id },
      data: { ...updateRoleDto },
    });
  }

  remove(id: string) {
    const foundRole = this.prisma.roles.findFirst({
      where: { role_id: id },
    });

    if (!foundRole) {
      throw new HttpException('El rol no existe', HttpStatus.NOT_FOUND);
    }
    return this.prisma.roles.delete({
      where: { role_id: id },
    });
  }
}
