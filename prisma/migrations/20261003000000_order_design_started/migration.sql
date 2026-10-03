-- "Empezar diseño": cuándo y quién empezó el montaje de un pedido.
ALTER TABLE "Order" ADD COLUMN "designStartedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "designStartedByName" TEXT;
ALTER TABLE "Order" ADD COLUMN "designStartedByUserId" INTEGER;
