-- Portal del cliente: enlace privado por pedido y respuestas del cliente al
-- diseño, pendientes de confirmar por Recepción (WORKFLOW.md §8).
CREATE TABLE "OrderShareLink" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastViewedAt" TIMESTAMP(3),
    "viewCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "OrderShareLink_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ClientDesignResponse" (
    "id" SERIAL NOT NULL,
    "orderId" INTEGER NOT NULL,
    "revisionId" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pendiente',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" INTEGER,

    CONSTRAINT "ClientDesignResponse_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OrderShareLink_orderId_key" ON "OrderShareLink"("orderId");
CREATE UNIQUE INDEX "OrderShareLink_token_key" ON "OrderShareLink"("token");
CREATE INDEX "ClientDesignResponse_orderId_status_idx" ON "ClientDesignResponse"("orderId", "status");
CREATE INDEX "ClientDesignResponse_revisionId_idx" ON "ClientDesignResponse"("revisionId");

ALTER TABLE "OrderShareLink" ADD CONSTRAINT "OrderShareLink_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientDesignResponse" ADD CONSTRAINT "ClientDesignResponse_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClientDesignResponse" ADD CONSTRAINT "ClientDesignResponse_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "DesignRevision"("id") ON DELETE CASCADE ON UPDATE CASCADE;
