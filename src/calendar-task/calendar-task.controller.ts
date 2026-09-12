import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CalendarTaskService } from './calendar-task.service';
import { CreateCalendarTaskDto } from './dto/create-calendar-task.dto';
import { UpdateCalendarTaskDto } from './dto/update-calendar-task.dto';
import { UpdateCalendarTaskCompleteDto } from './dto/calendar-task-complete.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';

/**
 * Lista de tareas pendientes del calendario de equipo: mismo acceso que
 * `CalendarEventController` (recepcion/admin/superuser, cualquiera ve y
 * edita cualquier tarea).
 */
@ApiTags('calendar-tasks')
@Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
@Controller('calendar-tasks')
export class CalendarTaskController {
  constructor(private readonly calendarTaskService: CalendarTaskService) {}

  @Post()
  create(
    @Body() dto: CreateCalendarTaskDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.calendarTaskService.create(dto, user.sub);
  }

  @Get()
  findAll() {
    return this.calendarTaskService.findAll();
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCalendarTaskDto,
  ) {
    return this.calendarTaskService.update(id, dto);
  }

  @Patch(':id/complete')
  setCompleted(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCalendarTaskCompleteDto,
  ) {
    return this.calendarTaskService.setCompleted(id, dto.completed);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.calendarTaskService.remove(id);
  }
}
