import {
  MiddlewareConsumer,
  Module,
  NestModule,
  RequestMethod,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { UsernameGenerationMiddleware } from './username-generator/username-generator.middleware';

@Module({
  imports: [PrismaModule],
  controllers: [UsersController],
  providers: [UsersService],
})
export class UsersModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer
      .apply(UsernameGenerationMiddleware)
      .forRoutes(
        { path: 'users', method: RequestMethod.POST },
        { path: 'users', method: RequestMethod.PATCH },
      );
  }
}
