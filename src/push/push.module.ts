import { Module } from '@nestjs/common';
import { PushService } from './push.service';
import { ExpoPushService } from './expo-push.service';
import { PushController } from './push.controller';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [PushController],
  providers: [PushService, ExpoPushService],
  exports: [PushService, ExpoPushService],
})
export class PushModule {}
