-- Flujo de Diseño (opcional): Recepción -> Diseño (opcional) -> Recepción
-- (autorización del cliente, con rondas de feedback) -> Producción.
--
-- `Order.area` sigue significando "dónde está el pedido AHORA" (gobierna
-- visibilidad, sin cambios de comportamiento para pedidos existentes:
-- default requiresDesign=true, pero como ya tienen `area` seteada nada las
-- mueve solas). `productionArea` es el destino de producción una vez
-- autorizado el diseño.
--
-- Los estados nuevos del flujo ('en diseño', 'esperando autorización',
-- 'cambios solicitados', 'autorizado') se agregan al final de STATUS_NAMES
-- en prisma/seed.ts (upsert por nombre) y se resuelven por NOMBRE en
-- runtime (ver resolveStatusIdByName en order.service.ts) -- esta migración
-- no toca la tabla Status.

ALTER TABLE "Order"
  ADD COLUMN "requiresDesign" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "productionArea" TEXT;

CREATE TABLE "DesignRevision" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,

    "montageFileData" TEXT,
    "montageFileName" TEXT,
    "montageFileMime" TEXT,
    "sentAt" TIMESTAMP(3),
    "sentByUserId" INTEGER,

    "feedbackText" TEXT,
    "feedbackFileData" TEXT,
    "feedbackFileName" TEXT,
    "feedbackFileMime" TEXT,
    "feedbackAt" TIMESTAMP(3),
    "feedbackByUserId" INTEGER,

    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approvedAt" TIMESTAMP(3),
    "approvedByUserId" INTEGER,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DesignRevision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DesignRevision_orderId_idx" ON "DesignRevision"("orderId");
CREATE INDEX "DesignRevision_orderId_round_idx" ON "DesignRevision"("orderId", "round");

ALTER TABLE "DesignRevision" ADD CONSTRAINT "DesignRevision_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DesignRevision" ADD CONSTRAINT "DesignRevision_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DesignRevision" ADD CONSTRAINT "DesignRevision_feedbackByUserId_fkey" FOREIGN KEY ("feedbackByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DesignRevision" ADD CONSTRAINT "DesignRevision_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
