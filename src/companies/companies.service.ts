import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class CompaniesService {
  constructor(private prisma: PrismaService) {}

  async create(createCompanyDto: CreateCompanyDto) {
    try {
      const existingCompany = await this.prisma.companies.findUnique({
        where: { company_name: createCompanyDto.company_name },
      });
      if (existingCompany) {
        throw new HttpException(
          'La compañia ya existe en la base de datos',
          HttpStatus.BAD_REQUEST,
        );
      }
      return this.prisma.companies.create({
        data: { ...createCompanyDto },
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  findAll() {
    return this.prisma.companies.findMany();
  }

  async findOne(id: string) {
    const foundCompany = await this.prisma.companies.findUnique({
      where: { company_id: id },
    });
    if (!foundCompany) {
      throw new HttpException('La compañia no existe', HttpStatus.NOT_FOUND);
    }
    return new HttpException(foundCompany, HttpStatus.FOUND);
  }

  async update(id: string, updateCompanyDto: UpdateCompanyDto) {
    try {
      const existingCompany = await this.prisma.companies.findUnique({
        where: { company_id: id },
      });
      if (!existingCompany) {
        throw new HttpException('La compañía no existe', HttpStatus.NOT_FOUND);
      }
      return await this.prisma.companies.update({
        where: { company_id: id },
        data: { ...updateCompanyDto },
      });
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }

  async remove(id: string) {
    try {
      // Verificar si la compañía existe antes de intentar eliminarla
      const existingCompany = await this.prisma.companies.findUnique({
        where: { company_id: id },
      });
      if (!existingCompany) {
        throw new HttpException('La compañía no existe', HttpStatus.NOT_FOUND);
      }
      // Eliminar la compañía
      await this.prisma.companies.delete({
        where: { company_id: id },
      });
      return new HttpException(
        `Se elimninó la compañia con id: ${id}`,
        HttpStatus.OK,
      );
    } catch (error) {
      throw new BadRequestException(error.message);
    }
  }
}
