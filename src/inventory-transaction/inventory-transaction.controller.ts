import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
} from '@nestjs/common';
import { InventoryTransactionService } from './inventory-transaction.service';
import { CreateInventoryTransactionDto } from './dto/create-inventory-transaction.dto';
import { UpdateInventoryTransactionDto } from './dto/update-inventory-transaction.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { Role } from 'src/common/enums/roles.enum';

@Controller('inventory-transactions')
export class InventoryTransactionController {
  constructor(
    private readonly inventoryTransactionService: InventoryTransactionService,
  ) {}

  @Post()
  @Auth(Role.TALLER)
  create(@Body() createInventoryTransactionDto: CreateInventoryTransactionDto) {
    return this.inventoryTransactionService.create(
      createInventoryTransactionDto,
    );
  }

  @Get()
  @Auth(Role.ADMIN, Role.TALLER)
  findAll() {
    return this.inventoryTransactionService.findAll();
  }

  @Get(':id')
  @Auth(Role.ADMIN, Role.TALLER)
  findOne(@Param('id') id: string) {
    return this.inventoryTransactionService.findOne(+id);
  }

  @Patch(':id')
  @Auth(Role.TALLER)
  update(
    @Param('id') id: string,
    @Body() updateInventoryTransactionDto: UpdateInventoryTransactionDto,
  ) {
    return this.inventoryTransactionService.update(
      +id,
      updateInventoryTransactionDto,
    );
  }

  @Delete(':id')
  @Auth(Role.TALLER)
  remove(@Param('id') id: string) {
    return this.inventoryTransactionService.remove(+id);
  }
}
