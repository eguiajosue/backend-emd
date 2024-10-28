import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}
  async create(createUserDto: CreateUserDto) {
    try {
      // eslint-disable-next-line prefer-const
      let { username, first_name, last_name } = createUserDto;

      if (!username) {
        username = `${first_name.substring(0, 1).toLowerCase()}${last_name.toLowerCase()}`;
      }

      const existingUser = await this.prisma.users.findFirst({
        where: { username },
      });

      if (existingUser) {
        throw new HttpException(
          'El usuario ya existe en la base de datos',
          HttpStatus.BAD_REQUEST,
        );
      }

      return this.prisma.users.create({
        data: { ...createUserDto, username },
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

  update(id: string, updateUserDto: UpdateUserDto) {
    try {
      const existingUser = this.prisma.users.findFirst({
        where: { user_id: id },
      });
      if (!existingUser) {
        throw new HttpException('El usuario no existe', HttpStatus.NOT_FOUND);
      }
      return this.prisma.users.update({
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
