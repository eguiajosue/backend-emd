import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Claves de TODOS los objetos del bucket que cuelgan de los pedidos que
 * cumplen `where`: archivo del cliente, archivos de cada ronda de diseño
 * (y sus escalares legacy, que comparten objeto) y mockups.
 *
 * Hay que llamarlo ANTES de borrar los pedidos: el borrado en cascada de la
 * DB se lleva las filas con las claves, pero no toca el bucket. Los adjuntos
 * del chat NO se incluyen: el mensaje sobrevive al pedido (`SetNull`).
 */
export async function collectOrderObjectKeys(
  prisma: PrismaService,
  where: Prisma.OrderWhereInput,
): Promise<string[]> {
  const orders = await prisma.order.findMany({
    where,
    select: {
      clientResourceFileKey: true,
      designRevisions: {
        select: {
          montageFileKey: true,
          feedbackFileKey: true,
          files: { select: { dataKey: true } },
        },
      },
      mockups: { select: { imageKey: true } },
    },
  });

  const keys = new Set<string>();
  const add = (key: string | null | undefined) => {
    if (key) keys.add(key);
  };
  for (const order of orders ?? []) {
    add(order.clientResourceFileKey);
    for (const revision of order.designRevisions ?? []) {
      add(revision.montageFileKey);
      add(revision.feedbackFileKey);
      for (const file of revision.files ?? []) add(file.dataKey);
    }
    for (const mockup of order.mockups ?? []) add(mockup.imageKey);
  }
  return [...keys];
}
