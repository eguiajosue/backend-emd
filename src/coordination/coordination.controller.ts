import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import type { AccessTokenPayload } from 'src/auth/auth.service';
import { CoordinationService } from './coordination.service';
import { DelayReasonDto } from './dto/delay-reason.dto';

/** Tablero de Coordinación: Recepción y gestión (WORKFLOW.md §9). */
@ApiTags('coordination')
@Controller('coordination')
@Auth(Role.RECEPCION, Role.ADMIN, Role.SUPERUSER)
export class CoordinationController {
  constructor(private readonly coordination: CoordinationService) {}

  @Get('overview')
  overview() {
    return this.coordination.overview();
  }

  @Patch('orders/:id/delay-reason')
  setDelayReason(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DelayReasonDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.coordination.setDelayReason(id, dto.reason, dto.note, user.sub);
  }
}
