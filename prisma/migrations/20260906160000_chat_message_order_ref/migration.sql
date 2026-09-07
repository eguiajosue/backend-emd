-- Referencia opcional de un mensaje de chat a un pedido, para dar contexto
-- sin obligar la relación en cada mensaje. SetNull: si el pedido se borra,
-- el mensaje queda sin la referencia en vez de desaparecer.
ALTER TABLE "ChatMessage" ADD COLUMN "orderId" INTEGER;

CREATE INDEX "ChatMessage_orderId_idx" ON "ChatMessage"("orderId");

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
