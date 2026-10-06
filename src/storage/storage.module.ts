import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Env } from '../config/env.validation';
import { createS3Client, S3ObjectStore } from './s3-object-store';
import { StorageDriver, StorageService } from './storage.service';

/** Variables de entorno que usa el almacenamiento (subconjunto de `Env`). */
export type StorageEnv = Pick<
  Env,
  | 'STORAGE_DRIVER'
  | 'S3_ENDPOINT'
  | 'S3_REGION'
  | 'S3_BUCKET'
  | 'S3_ACCESS_KEY_ID'
  | 'S3_SECRET_ACCESS_KEY'
>;

/**
 * Arma el `StorageService` a partir de las variables ya validadas. El
 * bucket se configura siempre que las S3_* estén completas (aunque el driver
 * sea `db`), para poder seguir leyendo las filas ya migradas tras un rollback.
 */
export function createStorageService(env: StorageEnv): StorageService {
  const driver: StorageDriver = env.STORAGE_DRIVER === 's3' ? 's3' : 'db';
  const s3Configured = Boolean(
    env.S3_ENDPOINT &&
      env.S3_BUCKET &&
      env.S3_ACCESS_KEY_ID &&
      env.S3_SECRET_ACCESS_KEY,
  );
  const store = s3Configured
    ? new S3ObjectStore(
        createS3Client({
          endpoint: env.S3_ENDPOINT!,
          region: env.S3_REGION || 'auto',
          bucket: env.S3_BUCKET!,
          accessKeyId: env.S3_ACCESS_KEY_ID!,
          secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
        }),
        env.S3_BUCKET!,
      )
    : null;
  return new StorageService(driver, store);
}

/**
 * Almacenamiento de archivos (Cloudflare R2 / S3 o legacy en la DB). Global:
 * lo usan pedidos, chat, mockups y usuarios sin tener que importarlo en cada
 * módulo. Ver docs/storage-r2.md.
 */
@Global()
@Module({
  providers: [
    {
      provide: StorageService,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) =>
        createStorageService({
          STORAGE_DRIVER: config.get('STORAGE_DRIVER', { infer: true }),
          S3_ENDPOINT: config.get('S3_ENDPOINT', { infer: true }),
          S3_REGION: config.get('S3_REGION', { infer: true }),
          S3_BUCKET: config.get('S3_BUCKET', { infer: true }),
          S3_ACCESS_KEY_ID: config.get('S3_ACCESS_KEY_ID', { infer: true }),
          S3_SECRET_ACCESS_KEY: config.get('S3_SECRET_ACCESS_KEY', {
            infer: true,
          }),
        }),
    },
  ],
  exports: [StorageService],
})
export class StorageModule {}
