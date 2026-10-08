-- Aviso al cliente cuando su pedido está listo (WORKFLOW.md §8): marca de
-- aviso enviado en el enlace y suscripciones Web Push del portal.
ALTER TABLE "OrderShareLink" ADD COLUMN "readyNotifiedAt" TIMESTAMP(3);

CREATE TABLE "PortalPushSubscription" (
    "id" SERIAL NOT NULL,
    "linkId" INTEGER NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PortalPushSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PortalPushSubscription_linkId_endpoint_key" ON "PortalPushSubscription"("linkId", "endpoint");

ALTER TABLE "PortalPushSubscription" ADD CONSTRAINT "PortalPushSubscription_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "OrderShareLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Los enlaces que ya existían con el pedido listo o entregado no avisan tarde.
UPDATE "OrderShareLink" l SET "readyNotifiedAt" = CURRENT_TIMESTAMP
FROM "Order" o JOIN "Status" s ON s."id" = o."statusId"
WHERE o."id" = l."orderId" AND lower(s."name") IN ('terminado', 'entregado');
