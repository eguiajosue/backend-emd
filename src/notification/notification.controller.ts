import { Controller, Get, Patch, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationService } from './notification.service';
import { PaginationQueryDto } from 'src/common/dto/pagination-query.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import { Role } from 'src/common/enums/roles.enum';
import { AccessTokenPayload } from 'src/auth/auth.service';

@Auth(
  Role.ADMIN,
  Role.RECEPCION,
  Role.SUPERUSER,
  Role.TALLER,
  Role.DTF,
  Role.BORDADO,
  Role.DISENO,
  Role.LASER,
  Role.IMPRESIONES,
)
@ApiTags('notifications')
@Controller('notifications')
export class NotificationController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  findAll(
    @Query() query: PaginationQueryDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.notificationService.findAllForUser(user.sub, query);
  }

  @Get('unread-count')
  unreadCount(@ActiveUser() user: AccessTokenPayload) {
    return this.notificationService.unreadCount(user.sub);
  }

  @Patch(':id/read')
  markAsRead(@Param('id') id: string, @ActiveUser() user: AccessTokenPayload) {
    return this.notificationService.markAsRead(+id, user.sub);
  }

  @Patch('read-all')
  markAllAsRead(@ActiveUser() user: AccessTokenPayload) {
    return this.notificationService.markAllAsRead(user.sub);
  }
}
