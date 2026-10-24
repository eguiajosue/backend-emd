import { Global, Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { AuditLogModule } from 'src/audit-log/audit-log.module';
import { AreaController } from './area.controller';
import { AreaService } from './area.service';
import { AreaAdminService } from './area-admin.service';

/** Global: pedidos, tareas, inventario, chat y reportes leen el catálogo. */
@Global()
@Module({
  imports: [PrismaModule, AuditLogModule],
  controllers: [AreaController],
  providers: [AreaService, AreaAdminService],
  exports: [AreaService],
})
export class AreaModule {}
