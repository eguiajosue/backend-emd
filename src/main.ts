import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as compression from 'compression';
import helmet from 'helmet';
import { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { Env } from './config/env.validation';

function parseOrigins(frontendUrl: string): string[] {
  return frontendUrl
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Basic auth mínimo para /api/docs cuando SWAGGER_USER/SWAGGER_PASSWORD existen. */
function basicAuth(user: string, password: string) {
  const expected =
    'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.headers.authorization === expected) {
      return next();
    }
    res.setHeader('WWW-Authenticate', 'Basic realm="API docs"');
    res.status(401).send('Unauthorized');
  };
}

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: false });
  const config = app.get(ConfigService<Env, true>);
  const logger = new Logger('Bootstrap');

  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  app.use(helmet());
  app.use(compression());

  app.enableCors({
    origin: parseOrigins(config.get('FRONTEND_URL', { infer: true })),
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter(isProduction));
  app.useGlobalInterceptors(new LoggingInterceptor());

  // Cierre ordenado: Nest ejecuta onModuleDestroy (Prisma $disconnect) y deja
  // de aceptar conexiones antes de morir. Necesario para escalar/redeployar
  // sin cortar requests en vuelo.
  app.enableShutdownHooks();

  // Socket.io: adaptador Redis sólo si hay REDIS_URL.
  const redisUrl = config.get('REDIS_URL', { infer: true });
  if (redisUrl) {
    const redisAdapter = new RedisIoAdapter(app, redisUrl);
    await redisAdapter.connect();
    app.useWebSocketAdapter(redisAdapter);
  } else {
    logger.warn(
      'REDIS_URL no definida: Socket.io funciona en memoria. Válido con UNA sola instancia; ' +
        'si se escala horizontalmente, las notificaciones no llegarán a los clientes conectados a otras instancias.',
    );
  }

  // Documentación OpenAPI.
  const swaggerUser = config.get('SWAGGER_USER', { infer: true });
  const swaggerPassword = config.get('SWAGGER_PASSWORD', { infer: true });
  if (swaggerUser && swaggerPassword) {
    app.use('/api/docs', basicAuth(swaggerUser, swaggerPassword));
    app.use('/api/docs-json', basicAuth(swaggerUser, swaggerPassword));
  }

  const swaggerConfig = new DocumentBuilder()
    .setTitle('EMD Bordados API')
    .setDescription(
      'API de gestión de pedidos y producción de EMD Bordados. ' +
        'Los endpoints de listado soportan paginación opt-in (?page=&limit=).',
    )
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs-json',
  });

  const port =
    config.get('PORT', { infer: true }) ??
    config.get('BACKEND_PORT', { infer: true });

  await app.listen(port);
  logger.log(`API escuchando en el puerto ${port}`);
}

void bootstrap();
