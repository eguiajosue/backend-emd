# Áreas de trabajo

Las áreas dejan de estar fijas en el código y pasan a ser un catálogo en la
base: todo el sistema lee las áreas de la tabla `Area`. Fase 1: el catálogo y
su uso. Fase 2: alta (wizard), edición y desactivación desde la app.

## Modelo

- `Area`: `slug` (estable, en ASCII, es lo que se guarda en `Order.area`,
  `OrderAreaTask.area`, `InventoryItem.area` y `ChatConversation.area`),
  `name`, `icon` (nombre de ícono de lucide-react), `color` (`#rrggbb`),
  `isDesign`, `isProductionDestination`, `hasInventory`,
  `generalViewEnabled`, `sortOrder` y `active`.
- `User.areas`: en qué áreas trabaja cada persona (y la cuenta compartida del
  área). **Separado de `User.roles`**: el rol dice qué puede hacer
  (admin, recepción, superusuario, sucursal), el área dónde trabaja.
- Diseño sigue siendo especial (`isDesign`): fase previa con su propio
  circuito, nunca destino de producción. Su slug (`diseno`) está fijo en
  `DESIGN_AREA`. Bordado conserva sus etapas de digitalizado y pruebas
  (`EMBROIDERY_AREA`) hasta la fase 3 (etapas configurables).

## Migración `20261024120000_areas_catalog`

1. Crea `Area` y `_AreaToUser`.
2. Siembra las seis áreas con el mismo nombre, ícono y color que tenían en el
   frontend, copiando `generalViewEnabled` de `AreaVisibilitySetting`.
3. Quien tenía el rol de un área pasa a pertenecer a esa área.
4. Borra los roles `taller`, `dtf`, `bordado`, `diseno`, `laser` e
   `impresiones` y la tabla `AreaVisibilitySetting`.

## Sesión y permisos

- El access token y la respuesta de `/auth/login` y `/auth/refresh` traen
  `areas` (slugs de áreas activas) además de `roles`.
- En `@Auth(...)` las áreas se piden con `AreaAccess`:
  `ANY` (cualquier área), `PRODUCTION` (cualquiera menos Diseño), `DESIGN`
  y `EMBROIDERY`. Ejemplo: `@Auth(Role.RECEPCION, AreaAccess.PRODUCTION)`.
- Tokens emitidos antes del despliegue (con las áreas dentro de `roles`) se
  siguen aceptando: `AuthGuard` y el gateway los normalizan con
  `normalizeAccessPayload`. Ese puente se puede quitar cuando venzan
  (`JWT_REFRESH_EXPIRES_IN`, 7 días por defecto).
- Los sockets se unen a la sala `area:<slug>` de cada área de la sesión.

## Endpoints

- `GET /areas`: catálogo de áreas activas, para cualquier sesión.
  `?includeInactive=true` (administración y Recepción) suma las desactivadas.
- `GET /areas/overview` (admin/superuser): todas las áreas con usuarios,
  cuenta compartida y pedidos/tareas abiertos.
- `POST /areas` (admin/superuser): alta desde el wizard. Genera el slug del
  nombre ("Impresión 3D" → `impresion-3d`; no cambia nunca), crea la cuenta
  compartida del área (sin contraseña conocida; opcional) y conecta a los
  usuarios elegidos, todo en una transacción. El canal de chat nace solo.
- `PATCH /areas/:id` (admin/superuser): nombre, ícono, color, comportamiento,
  sugerencias de inventario y `active`.
- `GET/PATCH /area-visibility`: se conserva con la misma forma
  (`role` = slug), ahora sobre `Area.generalViewEnabled`.
- `POST/PATCH /users`: aceptan `areaIds` además de `roleIds`; hace falta al
  menos un rol o un área. La respuesta trae `areas: [{ id, slug, name }]`.

## Validación

Los DTOs sólo validan el formato del slug (`@IsAreaSlug()`); que el área
exista, esté activa y sirva para ese uso lo comprueba el servicio con
`AreaService.assertArea(slug, 'any' | 'production')`. El catálogo se guarda en
memoria 30 s (`AreaService.CACHE_TTL_MS`) y se invalida en cada escritura.

## Alta, edición y desactivación (fase 2)

- Un área nunca se borra: sus pedidos, tareas e inventario guardan el slug.
- Desactivarla (o quitarla como destino de producción) se rechaza con 409 si
  tiene pedidos o tareas abiertos: hay que terminarlos o reasignarlos antes.
  Desactivada no se ofrece como destino ni da acceso; reactivarla la devuelve.
- Diseño se edita (nombre, ícono, color) pero no se desactiva ni se vuelve
  destino de producción. Su slug no se puede reutilizar.
- Los nombres no se repiten (sin importar mayúsculas) y no pueden ser
  reservados (`admin`, `recepcion`, `superuser`, `sucursal`, `todas`, `all`).
- `inventoryCategories` / `inventoryUnits` sólo sugieren en el alta de
  artículos: el inventario sigue aceptando texto libre.
- Los íconos permitidos están en `src/area/area-icons.ts` (deben coincidir con
  el registro del frontend).
- Cada cambio queda en `AuditLog` (`area.create`, `area.update`,
  `area.deactivate`, `area.activate`).
- Quien se asigna a un área nueva ve su bandeja en cuanto renueva su sesión
  (al volver a entrar o cuando su token se renueva): las áreas viajan en el
  token.
