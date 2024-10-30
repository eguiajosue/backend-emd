import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { MaterialTypesService } from './material-types.service';
import { CreateMaterialTypeDto } from './dto/create-material-type.dto';
import { UpdateMaterialTypeDto } from './dto/update-material-type.dto';

@Controller('material-types')
export class MaterialTypesController {
  constructor(private readonly materialTypesService: MaterialTypesService) {}

  @Post()
  create(@Body() createMaterialTypeDto: CreateMaterialTypeDto) {
    return this.materialTypesService.create(createMaterialTypeDto);
  }

  @Get()
  findAll() {
    return this.materialTypesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.materialTypesService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() updateMaterialTypeDto: UpdateMaterialTypeDto,
  ) {
    return this.materialTypesService.update(id, updateMaterialTypeDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.materialTypesService.remove(id);
  }
}
