import { INestApplicationContext, Logger } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { ServerOptions } from 'socket.io';

/**
 * Adaptador de Socket.io con Redis pub/sub.
 *
 * Es OPCIONAL: sólo se usa si existe REDIS_URL. Sin Redis, Socket.io mantiene
 * las rooms en memoria del proceso, lo cual funciona perfecto con UNA instancia
 * (situación actual en el plan free de Render) pero rompe las notificaciones
 * en cuanto haya más de una: un cliente conectado a la instancia A no recibe
 * los eventos emitidos desde la instancia B.
 */
export class RedisIoAdapter extends IoAdapter {
  private readonly logger = new Logger('RedisIoAdapter');
  private adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private readonly redisUrl: string,
  ) {
    super(app);
  }

  async connect(): Promise<void> {
    const pubClient = createClient({ url: this.redisUrl });
    const subClient = pubClient.duplicate();

    await Promise.all([pubClient.connect(), subClient.connect()]);

    this.adapterConstructor = createAdapter(pubClient, subClient);
    this.logger.log(
      'Socket.io usando adaptador Redis (escalado horizontal OK)',
    );
  }

  createIOServer(port: number, options?: ServerOptions) {
    const server = super.createIOServer(port, options);
    if (this.adapterConstructor) {
      server.adapter(this.adapterConstructor);
    }
    return server;
  }
}
