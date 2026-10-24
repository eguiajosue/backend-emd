# Áreas de trabajo

Fase 1 de las áreas dinámicas: las áreas dejan de estar fijas en el código y
pasan a ser un catálogo en la base. Todavía no hay pantalla para dar de alta
áreas (eso es la fase 2, el wizard), pero todo el sistema ya lee las áreas de
la tabla `Area`.

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
- `GET/PATCH /area-visibility`: se conserva con la misma forma
  (`role` = slug), ahora sobre `Area.generalViewEnabled`.
- `POST/PATCH /users`: aceptan `areaIds` además de `roleIds`; hace falta al
  menos un rol o un área. La respuesta trae `areas: [{ id, slug, name }]`.

## Validación

Los DTOs sólo validan el formato del slug (`@IsAreaSlug()`); que el área
exista, esté activa y sirva para ese uso lo comprueba el servicio con
`AreaService.assertArea(slug, 'any' | 'production')`. El catálogo se guarda en
memoria 30 s (`AreaService.CACHE_TTL_MS`) y se invalida en cada escritura.
