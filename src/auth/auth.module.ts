import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { UserModule } from 'src/user/user.module';
import { GenerateUsernameMiddleware } from 'src/user/generate-username/generate-username.middleware';

@Module({
  controllers: [AuthController],
  providers: [AuthService],
  imports: [UserModule],
})
export class AuthModule {
  configure(consumer) {
    consumer.apply(GenerateUsernameMiddleware).forRoutes('auth/register');
  }
}
