import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { ActiveUser } from 'src/common/decorators/active-user.decorator';
import type { AccessTokenPayload } from 'src/auth/auth.service';
import { BugReportService } from './bug-report.service';
import { CreateBugReportDto } from './dto/create-bug-report.dto';

// Cualquier usuario autenticado puede reportar bugs, sin restricción de rol.
@ApiTags('bug-reports')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('bug-reports')
export class BugReportController {
  constructor(private readonly bugReportService: BugReportService) {}

  @Post()
  create(
    @Body() createBugReportDto: CreateBugReportDto,
    @ActiveUser() user: AccessTokenPayload,
  ) {
    return this.bugReportService.create(createBugReportDto, user);
  }
}
