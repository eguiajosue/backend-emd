import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { CompanyService } from './company.service';
import { CreateCompanyDto } from './dto/create-company.dto';
import { UpdateCompanyDto } from './dto/update-company.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { ApiTags } from '@nestjs/swagger';
import { ORDER_VIEWING_ROLES } from 'src/common/constants/order-viewing-roles';

@ApiTags('companies')
@Controller('companies')
export class CompanyController {
  constructor(private readonly companyService: CompanyService) {}

  @Post()
  @Auth(Role.ADMIN, Role.RECEPCION)
  create(@Body() createCompanyDto: CreateCompanyDto) {
    return this.companyService.create(createCompanyDto);
  }

  // Las empresas quedaban legibles SIN token: cualquiera con la URL de la API
  // se llevaba la cartera de clientes corporativos. Lectura restringida a los
  // mismos roles que ya pueden ver clientes/pedidos.
  @Auth(...ORDER_VIEWING_ROLES)
  @Get()
  findAll() {
    return this.companyService.findAll();
  }

  @Auth(...ORDER_VIEWING_ROLES)
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.companyService.findOne(+id);
  }

  @Patch(':id')
  @Auth(Role.ADMIN, Role.RECEPCION)
  update(@Param('id') id: string, @Body() updateCompanyDto: UpdateCompanyDto) {
    return this.companyService.update(+id, updateCompanyDto);
  }

  @Delete(':id')
  @Auth(Role.ADMIN, Role.RECEPCION)
  remove(@Param('id') id: string) {
    return this.companyService.remove(+id);
  }
}
