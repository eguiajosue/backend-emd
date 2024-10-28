import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ClientsService {
  constructor(private prisma: PrismaService) {}
  async create(createClientDto: CreateClientDto) {
    try {
      const existingCompany = await this.prisma.clients.findFirst({
        where: { name: createClientDto.name },
      });
      if (existingCompany) {
        throw new HttpException(
          'El cliente ya existe en la base de datos',
          HttpStatus.BAD_REQUEST,
        );
      }
      return this.prisma.clients.create({
        data: { ...createClientDto },
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  findAll() {
    return this.prisma.clients.findMany();
  }

  async findOne(id: string) {
    const foundClient = await this.prisma.clients.findFirst({
      where: { client_id: id },
    });

    if (!foundClient) {
      throw new HttpException('El cliente no existe', HttpStatus.NOT_FOUND);
    }
    return new HttpException(foundClient, HttpStatus.FOUND);
  }

  async update(id: string, updateClientDto: UpdateClientDto) {
    try {
      const existingClient = await this.prisma.clients.findFirst({
        where: { client_id: id },
      });
      if (!existingClient) {
        throw new HttpException('El cliente no existe', HttpStatus.NOT_FOUND);
      }
      return this.prisma.clients.update({
        where: { client_id: id },
        data: { ...updateClientDto },
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async remove(id: string) {
    try {
      const existingClient = await this.prisma.clients.findFirst({
        where: { client_id: id },
      });
      if (!existingClient) {
        throw new HttpException('El cliente no existe', HttpStatus.NOT_FOUND);
      }
      return await this.prisma.clients.delete({
        where: { client_id: id },
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
