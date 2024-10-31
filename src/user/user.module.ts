import { Module, RequestMethod } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { GenerateUsernameMiddleware } from './generate-username/generate-username.middleware';

@Module({
  imports: [PrismaModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {
  configure(consumer) {
    consumer.apply(GenerateUsernameMiddleware).forRoutes(
      { path: 'users', method: RequestMethod.POST }, // Aplicar al crear usuario
      { path: 'users/:id', method: RequestMethod.PATCH }, // Aplicar al actualizar usuario
    );
  }
}
