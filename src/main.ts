import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as compression from 'compression';
import helmet from 'helmet';
import { json, urlencoded, NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { Env } from './config/env.validation';
import {
  buildCorsOriginCallback,
  isOriginAllowed,
  parseAllowedOrigins,
} from './common/cors-origin';

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
  // bodyParser deshabilitado acá para poder fijar un límite explícito (los
  // archivos de un pedido viajan en base64 dentro del JSON, ver
  // MAX_ORDER_FILE_BYTES en order.service.ts): 10mb cubre eso con
  // margen sin dejar el límite sin techo (Express default es 100kb).
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    bodyParser: false,
  });
  app.use(json({ limit: '10mb' }));
  app.use(urlencoded({ extended: true, limit: '10mb' }));
  const config = app.get(ConfigService<Env, true>);
  const logger = new Logger('Bootstrap');

  const isProduction = config.get('NODE_ENV', { infer: true }) === 'production';

  // Configuración explícita en vez de los defaults de helmet() a secas: CSP
  // restrictiva (sólo 'self', sin scripts/estilos externos -- esta API no
  // sirve HTML propio más allá de Swagger, así que puede ser estricta), HSTS
  // con preload (sólo tiene efecto real detrás de HTTPS, que es como corre
  // en producción), y los headers clásicos anti-clickjacking/MIME-sniffing.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      hsts: {
        maxAge: 15552000, // 180 días
        includeSubDomains: true,
        preload: true,
      },
      noSniff: true, // X-Content-Type-Options: nosniff
      frameguard: { action: 'deny' }, // X-Frame-Options: DENY
    }),
  );
  app.use(compression());

  const allowedOrigins = parseAllowedOrigins(
    config.get('FRONTEND_URL', { infer: true }),
  );
  // Diagnóstico de CORS, ANTES del middleware de cors.
  //
  // El paquete `cors` no responde el preflight cuando el callback de origin
  // devuelve false: llama a next() y el OPTIONS termina cayendo en el router,
  // que responde `404: Cannot OPTIONS /orders`. Eso oculta la causa real (un
  // origin no permitido) detrás de un 404 que parece un endpoint faltante y,
  // del lado del navegador, se ve como "no se puede conectar al servidor".
  // Acá se corta antes: 403 explícito y un log que nombra el origin rechazado.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const origin = req.headers.origin;
    if (!origin || isOriginAllowed(origin, allowedOrigins)) return next();

    logger.warn(
      `CORS: origin no permitido "${origin}" (${req.method} ${req.originalUrl}). ` +
        `Agregalo a FRONTEND_URL (lista separada por comas). Permitidos: ${
          allowedOrigins.join(', ') || '(ninguno)'
        } + *.vercel.app del proyecto.`,
    );

    if (req.method === 'OPTIONS') {
      res.status(403).json({
        statusCode: 403,
        message: `Origin no permitido por CORS: ${origin}`,
        error: 'Forbidden',
      });
      return;
    }
    next();
  });

  app.enableCors({
    origin: buildCorsOriginCallback(allowedOrigins),
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
    // No es un warning: correr con una sola instancia es la configuración
    // soportada hoy (Render arranca con WEB_CONCURRENCY=1). Sólo deja
    // constancia de la condición que habría que revisar al escalar.
    logger.log(
      'Socket.io en memoria (sin REDIS_URL). Correcto con UNA sola instancia; ' +
        'al escalar horizontalmente hace falta REDIS_URL para que las notificaciones ' +
        'lleguen a los clientes conectados a otras instancias.',
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
