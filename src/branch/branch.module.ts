import { Module } from '@nestjs/common';
import { PrismaModule } from 'src/prisma/prisma.module';
import { BranchController } from './branch.controller';
import { BranchService } from './branch.service';

/** Sucursales (ej. "Punto Madero") y sus empleados. */
@Module({
  imports: [PrismaModule],
  controllers: [BranchController],
  providers: [BranchService],
  exports: [BranchService],
})
export class BranchModule {}
