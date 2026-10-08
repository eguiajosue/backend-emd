-- Coordinación: motivo del atraso de un pedido.
ALTER TABLE "Order" ADD COLUMN "delayReason" TEXT;
ALTER TABLE "Order" ADD COLUMN "delayNote" TEXT;
ALTER TABLE "Order" ADD COLUMN "delayReasonAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "delayReasonById" INTEGER;
