import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AreaVisibilityService } from './area-visibility.service';
import { UpdateAreaVisibilityDto } from './dto/update-area-visibility.dto';
import { Auth } from 'src/common/decorators/auth.decorator';
import { ORDER_VIEWING_ROLES } from 'src/common/constants/order-viewing-roles';
import { Role } from 'src/common/enums/roles.enum';

@Auth(Role.ADMIN, Role.SUPERUSER, Role.RECEPCION)
@ApiTags('area-visibility')
@Controller('area-visibility')
export class AreaVisibilityController {
  constructor(private readonly areaVisibilityService: AreaVisibilityService) {}

  @Auth(...ORDER_VIEWING_ROLES)
  @Get()
  findAll() {
    return this.areaVisibilityService.findAll();
  }

  @Patch(':role')
  update(
    @Param('role') role: string,
    @Body() updateAreaVisibilityDto: UpdateAreaVisibilityDto,
  ) {
    return this.areaVisibilityService.update(
      role,
      updateAreaVisibilityDto.generalViewEnabled,
    );
  }
}
