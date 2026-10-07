# Sucursales (Punto Madero)

Una sucursal es una extensión de la matriz EMD (no otra empresa). Entra con UNA
cuenta compartida con el rol `sucursal`; todo lo que levanta le llega a
Recepción de la matriz y se gestiona con el flujo normal.

## Qué puede hacer la cuenta de sucursal

- Crear pedidos (`POST /orders`), eligiendo SIEMPRE un empleado activo de su
  sucursal (`branchEmployeeId`; 400 si falta, es de otra sucursal o está inactivo).
- Ver SÓLO los pedidos levantados desde su sucursal (`GET /orders`,
  `GET /orders/:id`, avance `area-tasks` y hoja de autorización `design-revisions`,
  siempre de lectura). Un pedido ajeno responde 403.
- Usar Mockups: plantillas y logos (leer, guardar, usar) y adjuntarlos a sus
  pedidos (`branchEmployeeId` opcional en el mockup). Renombrar/borrar queda
  para la matriz.
- Catálogos de lectura que necesita el alta (clientes, usuarios, estados,
  presets) y `GET /branches/me` (su sucursal y empleados activos).
- Nada más: cualquier otra ruta responde 403 por `RolesGuard`.

## Modelo

`Branch {id, name, active}`, `BranchEmployee {id, branchId, name, active}`,
`User.branchId`, `Order.branchId` y `Order.branchEmployeeId`,
`OrderMockup.branchEmployeeId`. Migración `20261008120000_branches`.

## Puesta en marcha (una sola vez)

1. Desplegar: `prisma migrate deploy` y el seed (idempotente) crean el rol
   `sucursal` y la sucursal "Punto Madero". El seed NO crea ningún usuario ni
   contraseña.
2. Entrar como admin → Usuarios → pestaña Sucursales → agregar los empleados de
   Punto Madero.
3. Usuarios → pestaña Usuarios → Nuevo usuario: marcar "Cuenta de área
   (compartida)", nombre "Punto Madero", usuario p. ej. `puntomadero`, una
   contraseña segura, rol "Sucursal" y sucursal "Punto Madero".
4. Quien quiera dar de baja a un empleado lo desactiva en Sucursales (deja de
   aparecer al crear pedidos pero sus pedidos viejos conservan el nombre).

## API de administración (admin/superuser; Recepción sólo lee `GET /branches`)

- `GET/POST /branches`, `PATCH /branches/:id` (`name`, `active`)
- `GET/POST /branches/:id/employees`, `PATCH /branches/:id/employees/:employeeId`
  (`name`, `active`)
- `GET /branches/me` (rol `sucursal`)
