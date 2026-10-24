import { Global, Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AreaController } from './area.controller';
import { AreaService } from './area.service';

/** Global: pedidos, tareas, inventario, chat y reportes leen el catálogo. */
@Global()
@Module({
  imports: [PrismaModule],
  controllers: [AreaController],
  providers: [AreaService],
  exports: [AreaService],
})
export class AreaModule {}
