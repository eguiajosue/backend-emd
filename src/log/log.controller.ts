import { Controller, Get, Post, Body, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { LogService } from './log.service';
import { CreateLogDto } from './dto/create-log.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { Role } from 'src/common/enums/roles.enum';

@Auth(Role.ADMIN)
@ApiTags('logs')
@Controller('logs')
export class LogController {
  constructor(private readonly logService: LogService) {}

  @Post()
  create(@Body() createLogDto: CreateLogDto) {
    return this.logService.create(createLogDto);
  }

  @Get()
  findAll(@Query() query: PaginationQueryDto) {
    return this.logService.findAll(query);
  }
}
