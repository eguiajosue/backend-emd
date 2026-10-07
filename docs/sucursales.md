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
- Clientes PROPIOS (ver abajo), catálogos de lectura que necesita el alta
  (usuarios, estados, presets), `POST /order-product-presets` y
  `GET /branches/me` (su sucursal y empleados activos).
- Nada más (en particular NADA de `/inventory/*`, reabasto, bitácora, escáner ni
  la hoja de materiales de la matriz; lo vigila `branch.surface.spec.ts`): cualquier otra ruta responde 403 por `RolesGuard`.

## Modelo

`Branch {id, name, active}`, `BranchEmployee {id, branchId, name, active}`,
`User.branchId`, `Order.branchId` y `Order.branchEmployeeId`,
`OrderMockup.branchEmployeeId`, `Client.branchId`. Migraciones
`20261008120000_branches` y `20261009120000_client_branch` (aditiva).

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

## Clientes por sucursal

`Client.branchId` (null = cliente de la matriz). Cada sucursal tiene los suyos.

- Cada cliente de las respuestas trae `branchId` y `branch: {id, name} | null`.
- Cuenta sólo-sucursal:
  - `GET /clients` devuelve SÓLO los de su sucursal (con o sin `page`/`limit`);
    ignora `branchId`/`scope`.
  - `GET /clients/:id` y `PATCH /clients/:id` de un cliente de la matriz o de
    otra sucursal responden **403** ("No tienes acceso a este cliente"); 404 si
    no existe. `PATCH` nunca cambia la sucursal dueña.
  - `POST /clients` fija `branchId` = su sucursal (inactiva o sin sucursal: 403).
    Un `branchId` en el body lo rechaza el ValidationPipe global (400,
    `forbidNonWhitelisted`); el service además lo descarta.
  - `DELETE /clients/:id` y `GET /clients/:id/orders` son sólo de la matriz (403):
    la sucursal no borra clientes (decisión conservadora; un cliente borrado
    afectaría pedidos y plantillas).
- Matriz (admin/superuser/recepción/áreas): ve TODOS. Filtros opcionales en
  `GET /clients`: `?branchId=3` (una sucursal) o `?scope=matriz|sucursal`.
  `POST /clients` desde la matriz crea con `branchId` null.
- `POST /orders` desde sucursal: `clientId`, si viene, debe ser de SU sucursal
  (si es de la matriz, de otra sucursal o no existe: **400** "El cliente no
  pertenece a tu sucursal..."). Sin cliente registrado se sigue usando
  `clientNameOverride`.
- Plantillas de cliente, cotizaciones, client-insight y `GET /clients/:id/orders`
  no están abiertos al rol sucursal (403 por RolesGuard).

## Historial propio de pedidos

`GET /orders` para la cuenta de sucursal lista TODOS sus pedidos (también
terminados/entregados/archivados; sólo los de su sucursal vía `branchOrdersWhere`),
ordenados por `creationDate` desc (luego `id` desc). Query opcional:

| param      | descripción |
|------------|-------------|
| `q`        | texto: id exacto del pedido (`42` o `#42`), descripción, nombre libre del cliente, nombre/apellido del cliente o su empresa (insensible a mayúsculas) |
| `statusId` | estado del pedido |
| `from`/`to`| rango de `creationDate` (ISO; si `to` es `YYYY-MM-DD` incluye todo ese día) |
| `page`/`limit` | paginación OPT-IN (`limit` máx. 200): sin ellos responde el array plano de siempre |

Con `page` o `limit` responde `{ data: Pedido[], meta: { total, page, limit, totalPages } }`.
Cada pedido incluye `client`, `status`, `branch {id,name}`, `branchEmployee {id,name}`,
`orderProducts`, `creationDate`, `deliveryDate`, `deliveredAt`, `description`, etc.
Los filtros van en AND con la visibilidad del rol (no amplían nada; valen
también para los demás roles, que conservan su orden por `id`).

## Productos frecuentes

`POST /order-product-presets` body `{ "name": "Termo" }` (trim, 1-80 caracteres)
-> `{ id, name, uses }`. Find-or-create idempotente e insensible a
mayúsculas/acentos/espacios (`"camion"` devuelve `"Camión"` existente). Roles:
admin, superuser, recepción y sucursal. No hay DELETE global. Cada cuenta guarda
sus favoritos (`frequentProductIds`) con `PATCH /users/me/preferences`, abierto a
cualquier usuario autenticado (incluida la sucursal).
