import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateMaterialTypeDto } from './dto/create-material-type.dto';
import { UpdateMaterialTypeDto } from './dto/update-material-type.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class MaterialTypesService {
  constructor(private prisma: PrismaService) {}

  async create(createMaterialTypeDto: CreateMaterialTypeDto) {
    try {
      const existingMaterial = await this.prisma.material_Types.findFirst({
        where: {
          type_name: createMaterialTypeDto.type_name,
        },
      });
      if (existingMaterial) {
        return new HttpException(
          'Ya existe un material con ese nombre',
          HttpStatus.BAD_REQUEST,
        );
      }
      return await this.prisma.material_Types.create({
        data: createMaterialTypeDto,
      });
    } catch (error) {
      return new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async findAll() {
    const existingMaterialTypes = await this.prisma.material_Types.count();
    if (existingMaterialTypes === 0) {
      return new HttpException(
        'No hay materiales registrados',
        HttpStatus.NOT_FOUND,
      );
    }
    return await this.prisma.material_Types.findMany();
  }
  async findOne(id: string) {
    try {
      const existingMaterial = await this.prisma.material_Types.findFirst({
        where: {
          type_id: id,
        },
      });

      if (!existingMaterial) {
        return new HttpException(
          'No existe un material con ese id',
          HttpStatus.NOT_FOUND,
        );
      }

      return existingMaterial;
    } catch (error) {
      return new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async update(id: string, updateMaterialTypeDto: UpdateMaterialTypeDto) {
    try {
      const existingMaterial = await this.prisma.material_Types.findFirst({
        where: {
          type_id: id,
        },
      });

      if (!existingMaterial) {
        return new HttpException(
          'No existe un material con ese id',
          HttpStatus.NOT_FOUND,
        );
      }

      return await this.prisma.material_Types.update({
        where: {
          type_id: id,
        },
        data: updateMaterialTypeDto,
      });
    } catch (error) {
      return new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  async remove(id: string) {
    try {
      const existingMaterial = await this.prisma.material_Types.findFirst({
        where: {
          type_id: id,
        },
      });

      if (!existingMaterial) {
        return new HttpException(
          'No existe un material con ese id',
          HttpStatus.NOT_FOUND,
        );
      }
      return await this.prisma.material_Types.delete({
        where: {
          type_id: id,
        },
      });
    } catch (error) {
      return new HttpException(error.message, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
