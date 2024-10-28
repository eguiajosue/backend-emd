import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}
  async create(createUserDto: CreateUserDto) {
    try {
      const existingUser = await this.prisma.users.findFirst({
        where: { username: createUserDto.username },
      });

      if (existingUser) {
        throw new HttpException(
          'El usuario ya existe en la base de datos',
          HttpStatus.BAD_REQUEST,
        );
      }

      return this.prisma.users.create({
        data: createUserDto,
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async findAll() {
    return await this.prisma.users.findMany();
  }

  async findOne(id: string) {
    const foundUser = await this.prisma.users.findFirst({
      where: { user_id: id },
    });
    if (!foundUser) {
      throw new HttpException('El usuario no existe', HttpStatus.NOT_FOUND);
    }
    return new HttpException(foundUser, HttpStatus.FOUND);
  }

  async update(id: string, updateUserDto: UpdateUserDto) {
    try {
      const existingUser = await this.prisma.users.findFirst({
        where: { user_id: id },
      });
      if (!existingUser) {
        throw new HttpException('El usuario no existe', HttpStatus.NOT_FOUND);
      }

      return await this.prisma.users.update({
        where: { user_id: id },
        data: { ...updateUserDto },
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async remove(id: string) {
    const foundUser = await this.prisma.users.findFirst({
      where: { user_id: id },
    });
    if (!foundUser) {
      throw new HttpException('El usuario no existe', HttpStatus.NOT_FOUND);
    }
    return this.prisma.users.delete({
      where: { user_id: id },
    });
  }
}
