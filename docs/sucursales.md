# Sucursales (Punto Madero)

Una sucursal es una extensión de la matriz EMD (no otra empresa). Entra con UNA
cuenta compartida con el rol `sucursal`; todo lo que levanta le llega a
Recepción de la matriz y se gestiona con el flujo normal.

## Qué puede hacer la cuenta de sucursal

- Crear pedidos (`POST /orders`), eligiendo SIEMPRE un empleado activo de su
  sucursal (`branchEmployeeId`; 400 si falta, es de otra sucursal o está inactivo).
- Ver SÓLO los pedidos levantados desde su sucursal (nunca los de la matriz ni los
  de otra sucursal; ver "Visibilidad" abajo) (`GET /orders`,
  `GET /orders/:id`, avance `area-tasks` y hoja de autorización `design-revisions`,
  siempre de lectura). Un pedido ajeno responde 403.
- Usar Mockups: plantillas y logos (leer, guardar, usar) y adjuntarlos a sus
  pedidos (`branchEmployeeId` opcional en el mockup). Renombrar/borrar queda
  para la matriz.
- Clientes PROPIOS (ver abajo), catálogos de lectura que necesita el alta
  (usuarios, estados, presets), `POST /order-product-presets` y
  `GET /branches/me` (su sucursal y empleados activos) y `GET /branches/logos`
  (logos de las sucursales, de lectura para todos los roles).
- Nada más (en particular NADA de `/inventory/*`, reabasto, bitácora, escáner ni
  la hoja de materiales de la matriz; lo vigila `branch.surface.spec.ts`): cualquier otra ruta responde 403 por `RolesGuard`.

## Modelo

`Branch {id, name, active}`, `BranchEmployee {id, branchId, name, active}`,
`User.branchId`, `Order.branchId` y `Order.branchEmployeeId`,
`OrderMockup.branchEmployeeId`, `Client.branchId`. Migraciones
`20261008120000_branches`, `20261009120000_client_branch` y
`20261010120000_branch_logos` (aditivas).

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
- Logos: ver la sección siguiente.

Las respuestas de sucursal (`GET /branches`, `POST/PATCH /branches`, `GET
/branches/me`) incluyen `hasLogoOnLight: boolean`, `hasLogoOnDark: boolean` y
`logoUpdatedAt: string | null` (ISO) y NUNCA las imágenes (los data URLs sólo
salen por `GET /branches/logos`).

## Logos de sucursal

Cada sucursal tiene DOS variantes de logo: `onLight` (para fondos CLAROS, logo
negro) y `onDark` (para fondos OSCUROS, logo blanco). Las sube el admin desde
Usuarios -> Sucursales.

**Subir / reemplazar** (sólo `admin` y `superuser`; throttle de 20 por minuto):

```
PUT /branches/:id/logo/:variant        :variant = onLight | onDark
{ "imageDataUrl": "data:image/png;base64,..." }
-> 200 { "branchId": 1, "variant": "onLight", "updatedAt": "2026-10-10T12:00:00.000Z" }
```

**Quitar** (sólo `admin` y `superuser`): `DELETE /branches/:id/logo/:variant` -> `204`
sin cuerpo (idempotente si esa variante no tenía logo).

Límites (se valida el contenido REAL, no sólo el mime del data URL):

| regla | respuesta |
|-------|-----------|
| Formatos: PNG, JPEG o WebP. SVG NO (puede llevar scripts) ni GIF | 400 |
| Firma real de bytes (`file-type`) igual al mime declarado | 400 |
| Base64 estricto, sin basura tras el padding | 400 |
| Máx. 400 KB decodificados | 413 |
| Máx. 2000 x 2000 px (leído de la cabecera PNG/JPEG/WebP); dimensiones ilegibles o 0 | 400 |
| `:variant` distinto de `onLight`/`onDark`; body vacío o con campos extra | 400 |
| Sucursal inexistente | 404 |
| Rol distinto de admin/superuser | 403 |

**Leer** (CUALQUIER usuario autenticado, de cualquier rol: lo usan las tarjetas de
producción y el Modo TV):

```
GET /branches/logos
-> 200 Array<{
     branchId: number; name: string;
     logoOnLight: string | null;   // data URL (data:image/png;base64,...) o null
     logoOnDark: string | null;
     updatedAt: string | null;     // ISO; sirve para invalidar la caché local
   }>
```

Sólo sucursales ACTIVAS, ordenadas por nombre. Va con `Cache-Control: private,
max-age=300` y `ETag` (Express responde 304 al revalidar), así que tras subir un
logo el navegador puede seguir mostrando el anterior hasta 5 minutos: el
frontend debe pedirlo con `cache: 'reload'` tras un PUT/DELETE. Un logo cuyo
objeto del bucket no se puede leer sale `null` en vez de romper la lista.

Almacenamiento: igual que los mockups (`StorageService`): con `STORAGE_DRIVER=db`
el base64 va en `Branch.logoOnLightData`/`logoOnDarkData`; con `s3` el objeto va
al bucket (`branches/logos/<uuid>.<ext>`) y la fila sólo guarda la clave
(`logoOnLightKey`/`logoOnDarkKey`). `...Mime` está si y sólo si la variante
tiene imagen. Reemplazar o quitar borra el objeto anterior del bucket. Los
logos nuevos no necesitan backfill (nunca hubo logos legacy).

## Visibilidad de pedidos (matriz vs sucursal)

- La matriz (admin, superuser, Recepción) ve los pedidos de TODAS las
  sucursales y los de la matriz. Los roles de área (taller, diseño, ...) ven por
  área, sean de la matriz o de una sucursal (el pedido de sucursal entra a
  producción como cualquier otro).
- La cuenta SÓLO-sucursal ve únicamente los pedidos de SU sucursal por TODAS las
  vías: `GET /orders`, `GET /orders/:id` (403 si es ajeno; 404 si no existe),
  `area-tasks`, `design-revisions` (rondas, montaje, feedback y archivos),
  `mockups` y `order-mockup`, adjuntos del pedido, notificaciones (lista y contador;
  tampoco se le crean avisos de pedidos ajenos) y los avisos en tiempo real
  (`orderStatusChangeNotification` ya no es broadcast: sale a todos menos a las
  cuentas de sucursal, y a la sucursal dueña por su room `branch:<id>`). Historial,
  búsqueda global, cotizaciones, calendario, tablero, rendimiento, chat e
  inventario responden 403 por rol.
- Una cuenta con el rol `sucursal` MÁS un rol de la matriz o de área ya no es
  "sólo sucursal" y ve lo de ese otro rol: no mezclar roles en la cuenta de
  Punto Madero.
- Pruebas: `order.branch-visibility.spec.ts` (siempre corre),
  `order.branch-visibility.db.spec.ts` (Postgres real; con
  `BRANCH_TEST_DATABASE_URL`), `branch.surface.spec.ts` y `branch.roles.spec.ts`.

## Filtrar pedidos por origen (matriz)

`GET /orders` acepta, además de `q`, `statusId`, `from`, `to`, `page`, `limit`:

| param | descripción |
|-------|-------------|
| `origin` | `matriz` = pedidos sin sucursal (`branchId IS NULL`); `sucursal` = pedidos de cualquier sucursal (`branchId IS NOT NULL`). Otro valor: 400 |
| `branchId` | entero: pedidos de ESA sucursal. No numérico: 400. Vacío = ausente |

Se combinan en AND con la visibilidad del rol y con los demás filtros (nunca
amplían; `branchId=2&origin=matriz` da vacío). Para la cuenta de sucursal se
IGNORAN (se aceptan sin error pero siempre ve sólo su sucursal).

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
