-- Elimina el estado "en pruebas" del flujo de pedidos.
--
-- Los pedidos que estén en ese estado se MIGRAN a "en proceso" (el paso
-- siguiente del flujo pendiente -> en proceso -> terminado -> entregado):
-- no se borran ni se ocultan.
--
-- Idempotente y segura con 0, algunos o muchos pedidos en el estado: todo
-- está condicionado a que el estado exista y a que exista el destino. El
-- historial (OrderHistory) también se reapunta, porque previousStatusId /
-- newStatusId son claves foráneas a Status y borrar la fila sin reapuntar
-- fallaría. Los textos ya escritos en logs de auditoría (OrderAuditLog) o
-- en notificaciones no referencian Status por FK, así que siguen
-- renderizando tal cual quedaron.
--
-- El id liberado (2 en una DB sembrada con prisma/seed.ts) NO se reutiliza:
-- otros ids están hardcodeados (DELIVERED_STATUS_ID = 5).

DO $$
DECLARE
  old_status_id INTEGER;
  target_status_id INTEGER;
BEGIN
  SELECT "id" INTO old_status_id FROM "Status" WHERE lower("name") = 'en pruebas';

  IF old_status_id IS NULL THEN
    RETURN; -- Nada que migrar: el estado ya no existe.
  END IF;

  SELECT "id" INTO target_status_id FROM "Status" WHERE lower("name") = 'en proceso';

  IF target_status_id IS NULL THEN
    -- Sin destino no se puede migrar: se deja el estado como está en vez de
    -- perder pedidos. (No debería pasar: 'en proceso' viene del seed.)
    RAISE NOTICE 'Status "en proceso" no encontrado; se omite la eliminación de "en pruebas".';
    RETURN;
  END IF;

  UPDATE "Order" SET "statusId" = target_status_id WHERE "statusId" = old_status_id;
  UPDATE "OrderHistory" SET "previousStatusId" = target_status_id WHERE "previousStatusId" = old_status_id;
  UPDATE "OrderHistory" SET "newStatusId" = target_status_id WHERE "newStatusId" = old_status_id;

  DELETE FROM "Status" WHERE "id" = old_status_id;
END
$$;
