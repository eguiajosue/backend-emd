-- Agrega el estado "cancelado" al flujo de pedidos.
--
-- Se siembra con id explícito = 10 (siguiente id libre después de los
-- estados 6-9 del flujo de Diseño), porque otros ids ya están hardcodeados
-- en el backend (ver DELIVERED_STATUS_ID = 5 en src/order/order.service.ts)
-- y conviene mantener la misma convención para "cancelado"
-- (CANCELLED_STATUS_ID = 10).
--
-- Idempotente: si el id ya existe (por ejemplo porque prisma/seed.ts ya lo
-- sembró) no hace nada.

INSERT INTO "Status" ("id", "name")
SELECT 10, 'cancelado'
WHERE NOT EXISTS (SELECT 1 FROM "Status" WHERE "id" = 10);

-- Al insertar con id explícito la secuencia del autoincremento no avanza:
-- la reposicionamos para que un futuro insert sin id no choque con una PK
-- ya usada (mismo patrón que prisma/seed.ts).
SELECT setval(
  pg_get_serial_sequence('"Status"', 'id'),
  (SELECT COALESCE(MAX("id"), 1) FROM "Status")
);
