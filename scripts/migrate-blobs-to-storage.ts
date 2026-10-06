/**
 * Backfill único: mueve los archivos que todavía están en base64 dentro de
 * Postgres al almacenamiento de objetos (Cloudflare R2 / S3).
 *
 *   npm run storage:backfill -- --dry-run          # sólo cuenta, no toca nada
 *   npm run storage:backfill                       # migra
 *   npm run storage:backfill -- --batch-size=10    # lotes más chicos
 *   npm run storage:backfill -- --only=OrderMockup.image,MockupLogo.image
 *
 * Idempotente y reanudable (se puede cortar y volver a correr). NO corre en
 * el deploy: se lanza a mano. Ver docs/storage-r2.md.
 */
import { existsSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { validateEnv } from '../src/config/env.validation';
import { createStorageService } from '../src/storage/storage.module';
import { backfillBlobs, BLOB_TARGETS } from '../src/storage/blob-backfill';

function parseArgs(argv: string[]) {
  const args = {
    dryRun: false,
    batchSize: undefined as number | undefined,
    only: [] as string[],
  };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg.startsWith('--batch-size=')) {
      const value = Number(arg.slice('--batch-size='.length));
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`--batch-size inválido: ${arg}`);
      }
      args.batchSize = value;
    } else if (arg.startsWith('--only=')) {
      args.only = arg
        .slice('--only='.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const known = new Set(BLOB_TARGETS.map((t) => t.name));
      const unknown = args.only.filter((name) => !known.has(name));
      if (unknown.length > 0) {
        throw new Error(
          `--only con campos desconocidos: ${unknown.join(', ')}. Válidos: ${[...known].join(', ')}`,
        );
      }
    } else {
      throw new Error(`Argumento desconocido: ${arg}`);
    }
  }
  return args;
}

async function main() {
  const logger = new Logger('StorageBackfill');
  // En local se lee el .env (en Render las variables ya están en el entorno).
  const loadEnvFile = (process as any).loadEnvFile as
    | ((path: string) => void)
    | undefined;
  if (existsSync('.env') && typeof loadEnvFile === 'function') {
    loadEnvFile('.env');
  }

  const args = parseArgs(process.argv.slice(2));
  const env = validateEnv(process.env);
  const storage = createStorageService(env);

  if (!storage.hasObjectStore && !args.dryRun) {
    throw new Error(
      'Faltan S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID o S3_SECRET_ACCESS_KEY: no hay a dónde migrar',
    );
  }
  if (!storage.writesToObjectStorage) {
    logger.warn(
      'STORAGE_DRIVER no es "s3": los archivos NUEVOS se seguirán guardando en la DB. Configurá STORAGE_DRIVER=s3 antes de migrar.',
    );
  }

  const prisma = new PrismaClient();
  try {
    logger.log(
      args.dryRun
        ? 'Modo dry-run: no se sube ni se modifica nada.'
        : 'Migrando archivos al bucket...',
    );
    const report = await backfillBlobs(prisma, storage, {
      dryRun: args.dryRun,
      batchSize: args.batchSize,
      only: args.only,
      logger,
    });
    for (const [name, counts] of Object.entries(report.targets)) {
      logger.log(
        `${name}: encontradas=${counts.scanned} ${args.dryRun ? 'a_migrar' : 'migradas'}=${counts.migrated} omitidas=${counts.skipped} con_error=${counts.failed} MB=${(counts.bytes / 1024 / 1024).toFixed(2)}`,
      );
    }
    const t = report.total;
    logger.log(
      `TOTAL: encontradas=${t.scanned} ${args.dryRun ? 'a_migrar' : 'migradas'}=${t.migrated} omitidas=${t.skipped} con_error=${t.failed} MB=${(t.bytes / 1024 / 1024).toFixed(2)}`,
    );
    if (t.failed > 0) {
      logger.error(
        'Hubo errores: esas filas quedaron intactas en la DB. Volvé a correr el comando para reintentarlas.',
      );
      process.exitCode = 1;
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  new Logger('StorageBackfill').error(error?.message ?? error);
  process.exit(1);
});
