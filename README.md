# Backend EMD Bordados

API de gestión de pedidos y producción (NestJS 10 + Prisma 5 + PostgreSQL + Socket.io).

## Puesta en marcha

```bash
npm install
cp .env.example .env      # completar DATABASE_URL y JWT_SECRET
npx prisma generate
npx prisma migrate deploy
npx prisma db seed
npm run start:dev
```

Las variables de entorno se validan al arranque (`src/config/env.validation.ts`,
zod). Si falta `DATABASE_URL` o `JWT_SECRET` (mínimo 32 caracteres) la app falla
inmediatamente con un mensaje claro en vez de arrancar rota.

## Documentación de la API

`GET /api/docs` (Swagger UI) y `GET /api/docs-json` (OpenAPI JSON).

Si se definen `SWAGGER_USER` y `SWAGGER_PASSWORD` quedan protegidos con basic
auth; si no, son públicos. En producción conviene definirlas: la doc no expone
datos, pero sí el mapa completo de endpoints.

## Health checks

- `GET /health` — liveness (proceso vivo). Público.
- `GET /health/ready` — readiness, incluye ping a PostgreSQL. Público.

Configurar `/health` como health check path en Render.

## Autenticación

`POST /auth/login` → `{ token, refreshToken, username, first_name, last_name, roles }`

- `token` es el access token (duración `JWT_ACCESS_EXPIRES_IN`, default `1d`).
- `refreshToken` (duración `JWT_REFRESH_EXPIRES_IN`, default `7d`) se canjea en
  `POST /auth/refresh` con body `{ "refreshToken": "..." }`, que devuelve el
  mismo shape que el login (con roles releídos de la base).
- Un refresh token NO sirve como access token: los endpoints protegidos lo
  rechazan con 401.

Cuando el frontend implemente el flujo de refresh, bajar `JWT_ACCESS_EXPIRES_IN`
a `15m`. Se mantiene en `1d` por defecto para no cerrar sesiones hoy.

Política de contraseñas (alta/edición de usuarios): mínimo 8 caracteres, al
menos una mayúscula y un número. Los intentos de login fallidos se registran en
el logger de Nest (usuario inexistente / contraseña incorrecta).

## Paginación (opt-in)

`GET /orders`, `GET /order-histories`, `GET /logs` y `GET /clients` aceptan
`?page=` y `?limit=`:

- Sin esos query params → **array plano**, igual que siempre (contrato actual).
- Con alguno de ellos → `{ data, meta: { total, page, limit, totalPages } }`.

Defaults: `page=1`, `limit=50`, máximo `limit=200` (un limit mayor devuelve 400).

## Shape de errores

Todos los errores se normalizan en `AllExceptionsFilter`:

```json
{
  "statusCode": 404,
  "message": "Orden no encontrada",
  "error": "Not Found",
  "timestamp": "2026-09-05T23:54:36.082Z",
  "path": "/orders/999",
  "requestId": "2e3857ef-..."
}
```

En producción nunca se devuelven stack traces ni mensajes internos de Prisma.
Errores de Prisma no capturados se mapean: P2002 → 409, P2025 → 404,
P2003 → 400.

## Trazabilidad

Cada request recibe un `x-request-id` (se propaga si el cliente ya lo manda) que
aparece en el header de respuesta, en los logs HTTP y en el body de error.

## Socket.io y escalado horizontal

Sin `REDIS_URL` el gateway mantiene las rooms en memoria: correcto con UNA
instancia (se loguea un warning al arrancar). Definiendo `REDIS_URL` se activa
`@socket.io/redis-adapter` y las notificaciones funcionan con N instancias sin
tocar código.

## Scripts

```bash
npm run build     # compila
npm run lint      # eslint --fix
npm test          # tests unitarios
```
