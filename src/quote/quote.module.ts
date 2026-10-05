import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { QuoteController } from './quote.controller';
import { QuoteService } from './quote.service';

/** Cotizaciones de Recepción (`/quotes`). */
@Module({
  imports: [PrismaModule],
  controllers: [QuoteController],
  providers: [QuoteService],
})
export class QuoteModule {}
