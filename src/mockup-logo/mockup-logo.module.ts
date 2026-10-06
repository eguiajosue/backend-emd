import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MockupLogoController } from './mockup-logo.controller';
import { MockupLogoService } from './mockup-logo.service';

/** Biblioteca de logos del creador de mockups, compartida por la empresa. */
@Module({
  imports: [PrismaModule],
  controllers: [MockupLogoController],
  providers: [MockupLogoService],
})
export class MockupLogoModule {}
