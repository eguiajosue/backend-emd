import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MockupTemplateController } from './mockup-template.controller';
import { MockupTemplateService } from './mockup-template.service';

/** Plantillas del creador de mockups, compartidas por la empresa. */
@Module({
  imports: [PrismaModule],
  controllers: [MockupTemplateController],
  providers: [MockupTemplateService],
})
export class MockupTemplateModule {}
