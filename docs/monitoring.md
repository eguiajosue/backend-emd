# Monitoreo de errores con Sentry

El backend reporta a [Sentry](https://sentry.io) los errores **inesperados**
(respuestas 5xx). Viene **apagado**: no hace nada hasta que se define
`SENTRY_DSN`.

## Qué se reporta y qué no

- **Sí**: cualquier error que termina en una respuesta 5xx (excepciones no
  controladas, errores de base no mapeados, un archivo que no se puede leer
  del almacenamiento, etc.). Cada evento lleva el `requestId` de la respuesta
  para cruzarlo con los logs de Render.
- **No**: los 4xx (validaciones, permisos, 404, conflictos). Son errores
  esperados del cliente, no bugs.
- **Datos personales**: no se mandan cuerpos de request (pedidos, archivos,
  contraseñas del login), cookies, el header `Authorization` ni datos del
  usuario (IP, email). Ver `src/common/sentry/sentry-options.ts`.

Cómo está armado (para quien toque el código):

- `src/instrument.ts` inicializa Sentry y es el **primer import** de
  `src/main.ts` (Sentry tiene que cargarse antes que Nest/Express para
  instrumentarlos).
- `SentryModule.forRoot()` está en `AppModule` (nombra las transacciones por
  ruta).
- El reporte lo hace el filtro global `AllExceptionsFilter`, sólo para
  status ≥ 500. No se usa el `SentryGlobalFilter` del SDK porque ese trata
  toda `HttpException` como esperada, incluidas las 500 que lanzan los
  services.
- Errores de los gateways de WebSocket y de las tareas programadas (cron) no
  pasan por ese filtro: hoy no se reportan.

## Configuración

1. En Sentry: **Create Project** → plataforma **NestJS** → nombre
   `backend-emd`.
2. Copiá el **DSN** (Settings → Projects → backend-emd → Client Keys (DSN)).
3. En Render → servicio `backend-emd` → **Environment**:

| Variable | Obligatoria | Valor |
| --- | --- | --- |
| `SENTRY_DSN` | Sí (sin ella, Sentry apagado) | El DSN del paso 2 |
| `SENTRY_ENVIRONMENT` | No | Ej. `production`. Default: `NODE_ENV` |
| `SENTRY_TRACES_SAMPLE_RATE` | No | `0` a `1`. Default `0` (sólo errores, sin trazas de performance). `0.1` = 10% de los requests con traza |

4. **Save Changes** → redeploy.

Para apagarlo, borrá `SENTRY_DSN` (o dejala vacía) y redeployá.

## Probar que llega

Con el DSN configurado, cualquier 500 aparece en Sentry → **Issues** en
segundos. Si no tenés un error a mano, en local:

```bash
export SENTRY_DSN="<el DSN>"
export SENTRY_ENVIRONMENT=local
npm run start:dev
```

Ojo: `SENTRY_DSN` se lee directo del entorno al arrancar, **antes** de que se
cargue el `.env`, así que en local hay que exportarla en la shell (ponerla
sólo en `.env` no alcanza). En Render no hay diferencia.
