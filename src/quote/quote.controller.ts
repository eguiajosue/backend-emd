import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';
import {
  BulkCreateQuotesDto,
  CreateQuoteDto,
  LinkQuoteOrderDto,
  ListQuotesQueryDto,
  UpdateQuoteDto,
} from './dto/quote.dto';
import { QuoteService } from './quote.service';

/**
 * Tablero de cotizaciones de Recepción. Sólo lo ve y lo administra quien
 * cotiza con el cliente: Recepción, admin y superuser (también para leer).
 */
@ApiTags('quotes')
@Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
@Controller('quotes')
export class QuoteController {
  constructor(private readonly quoteService: QuoteService) {}

  @Get()
  findAll(@Query() query: ListQuotesQueryDto) {
    return this.quoteService.findAll(query);
  }

  @Post()
  create(@Body() dto: CreateQuoteDto, @ActiveUser() user: AccessTokenPayload) {
    return this.quoteService.create(dto, user.sub);
  }

  @Post('bulk')
  createBulk(
    @Body() dto: BulkCreateQuotesDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.quoteService.createBulk(dto, user.sub);
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateQuoteDto) {
    return this.quoteService.update(id, dto);
  }

  @HttpCode(HttpStatus.OK)
  @Post(':id/link-order')
  linkOrder(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LinkQuoteOrderDto,
  ) {
    return this.quoteService.linkOrder(id, dto.orderId);
  }

  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.quoteService.remove(id);
  }
}
