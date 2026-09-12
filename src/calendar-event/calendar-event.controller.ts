import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CalendarEventService } from './calendar-event.service';
import { CreateCalendarEventDto } from './dto/create-calendar-event.dto';
import { UpdateCalendarEventDto } from './dto/update-calendar-event.dto';
import { UpdateCalendarEventStatusDto } from './dto/calendar-event-status.dto';
import { CalendarEventQueryDto } from './dto/calendar-event-query.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';

/**
 * Calendario de equipo de Recepción: sólo recepcion/admin/superuser lo ven o
 * lo tocan, y una vez adentro cualquiera de esos roles puede ver y editar
 * cualquier evento (es un calendario de equipo, no uno por persona).
 */
@ApiTags('calendar-events')
@Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
@Controller('calendar-events')
export class CalendarEventController {
  constructor(private readonly calendarEventService: CalendarEventService) {}

  @Post()
  create(
    @Body() dto: CreateCalendarEventDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.calendarEventService.create(dto, user.sub);
  }

  @Get()
  findAll(@Query() query: CalendarEventQueryDto) {
    return this.calendarEventService.findAll(query);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.calendarEventService.findOne(id);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCalendarEventDto,
  ) {
    return this.calendarEventService.update(id, dto);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCalendarEventStatusDto,
  ) {
    return this.calendarEventService.updateStatus(id, dto.status);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.calendarEventService.remove(id);
  }
}
