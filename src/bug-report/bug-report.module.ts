import { Module } from '@nestjs/common';
import { BugReportService } from './bug-report.service';
import { BugReportController } from './bug-report.controller';
import { UserModule } from 'src/user/user.module';

@Module({
  imports: [UserModule],
  controllers: [BugReportController],
  providers: [BugReportService],
})
export class BugReportModule {}
