# Archivos en Cloudflare R2

Hasta ahora todos los archivos (recursos del cliente, montajes y feedback de
diseño, adjuntos del chat, mockups, plantillas y logos) se guardaban en base64
dentro de Postgres. Eso infla la base, los backups y cada consulta que toca
esas tablas. Este documento explica cómo pasarlos a **Cloudflare R2** (un
almacenamiento de objetos compatible con S3).

**El frontend no cambia.** La API responde exactamente lo mismo que antes (las
mismas data URLs). Sólo cambia dónde vive el archivo.

## Cómo funciona

- Cada campo de archivo tiene ahora una columna `...Key` (la clave del objeto
  en R2) además de la columna base64 de siempre.
- Una fila es **legacy** (base64 en la DB, sin clave) o **migrada** (clave en
  R2, base64 en `null`). Al leer, si hay clave se baja de R2; si no, se usa la
  columna. Las dos conviven sin problema.
- `STORAGE_DRIVER` decide sólo dónde se guardan los archivos **nuevos**:
  - `db` (o sin definir): en Postgres, como siempre.
  - `s3`: en R2.
- Al borrar un pedido, un mockup, una plantilla, un logo o un usuario (con sus
  pedidos), también se borran sus objetos de R2. Si ese borrado falla, sólo
  queda logueado (un objeto huérfano no afecta a nadie).

| Tabla | Columna base64 | Columna nueva |
| --- | --- | --- |
| `Order` | `clientResourceFileData` | `clientResourceFileKey` |
| `DesignRevision` | `montageFileData` / `feedbackFileData` | `montageFileKey` / `feedbackFileKey` |
| `DesignRevisionFile` | `data` | `dataKey` |
| `ChatMessage` | `attachmentData` | `attachmentKey` |
| `OrderMockup` | `imageData` | `imageKey` |
| `MockupTemplate` | `thumbnailData` | `thumbnailKey` |
| `MockupLogo` | `imageData` / `thumbnailData` | `imageKey` / `thumbnailKey` |

La migración de base (`20261007120000_object_storage_keys`) se aplica sola en
el próximo deploy: sólo agrega columnas y vuelve nullable las de base64. No
mueve ni borra nada.

## Paso 1: crear el bucket en Cloudflare

1. Entrá a <https://dash.cloudflare.com> → **R2 Object Storage**. La primera
   vez te pide activar R2 (hay que cargar un medio de pago, pero el plan
   gratuito incluye 10 GB y no cobra por descargas).
2. **Create bucket**:
   - Nombre: por ejemplo `emd-archivos` (sólo minúsculas, números y guiones).
   - Location: *Automatic*.
   - Default storage class: *Standard*.
3. **No** actives el acceso público del bucket (*Public access* debe quedar
   deshabilitado). La app es la única que lee los archivos.
4. Anotá el **Account ID**: aparece en la página principal de R2, a la derecha
   ("Account Details"). El endpoint es
   `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.

## Paso 2: crear el token de acceso

1. En R2 → **Manage R2 API Tokens** (o "API" → "Manage API tokens") →
   **Create API token**.
2. Configuración:
   - Token name: `backend-emd-render`.
   - Permissions: **Object Read & Write**.
   - Specify bucket(s): **Apply to specific buckets only** → elegí
     `emd-archivos`.
   - TTL: *Forever* (o la fecha que prefieras; si vence, la app deja de poder
     leer y escribir archivos).
3. **Create API Token** y copiá **Access Key ID** y **Secret Access Key**. El
   secreto se muestra una sola vez: si lo perdés, hay que crear otro token.

## Paso 3: variables de entorno en Render

En el servicio `backend-emd` → **Environment** → agregá:

| Variable | Valor |
| --- | --- |
| `STORAGE_DRIVER` | `s3` |
| `S3_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `S3_REGION` | `auto` |
| `S3_BUCKET` | `emd-archivos` |
| `S3_ACCESS_KEY_ID` | el Access Key ID del paso 2 |
| `S3_SECRET_ACCESS_KEY` | el Secret Access Key del paso 2 |

**Save Changes** → Render redeploya. Si falta alguna de las `S3_*` con
`STORAGE_DRIVER=s3`, la app **no arranca** y el log dice cuál falta (mejor eso
que arrancar y fallar al primer archivo).

Desde este momento los archivos **nuevos** van a R2. Los viejos siguen en la
base hasta que corras el backfill.

**Probalo antes de seguir:** subí un archivo de prueba (por ejemplo un mockup a
un pedido) y abrilo. En el dashboard de R2 → `emd-archivos` → **Objects**
tiene que aparecer bajo `orders/mockups/`.

## Paso 4: mover los archivos viejos (backfill)

El script `npm run storage:backfill` mueve las filas legacy a R2 por lotes.
**No corre solo en el deploy**: se lanza a mano, una vez.

Es seguro:

- **Idempotente y reanudable**: sólo toma filas que todavía no tienen clave, y
  la clave de cada fila es siempre la misma. Si se corta (timeout, deploy,
  cierre de la shell), se vuelve a correr y sigue donde quedó.
- **Nunca borra el base64 sin verificar**: sube el objeto, lo vuelve a leer de
  R2 (tamaño exacto) y recién entonces escribe la clave y pone la columna en
  `null`. Si la fila cambió mientras tanto, no la toca.
- Si algo falla, esa fila queda intacta en la base y el script termina con
  código de error; volvé a correrlo para reintentar.

### Opción A: desde la Shell de Render (instancias pagas)

En el servicio → **Shell**:

```bash
# 1. Ver qué se va a migrar, sin tocar nada:
npm run storage:backfill -- --dry-run

# 2. Migrar:
npm run storage:backfill
```

Si la instancia tiene poca memoria (512 MB), usá lotes más chicos:
`npm run storage:backfill -- --batch-size=5`.

### Opción B: desde tu compu (plan Free, que no tiene Shell)

1. En Render → la base de datos → **Connections** → copiá la **External
   Database URL**.
2. En `backend-emd` (con `npm install` hecho), con las mismas variables que en
   Render:

   ```bash
   export DATABASE_URL="<External Database URL>"
   export JWT_SECRET="<el mismo de Render>"
   export STORAGE_DRIVER=s3
   export S3_ENDPOINT="https://<ACCOUNT_ID>.r2.cloudflarestorage.com"
   export S3_REGION=auto
   export S3_BUCKET=emd-archivos
   export S3_ACCESS_KEY_ID="..."
   export S3_SECRET_ACCESS_KEY="..."

   npm run storage:backfill -- --dry-run
   npm run storage:backfill
   ```

### Qué muestra

Una línea por campo y un total, por ejemplo:

```
Order.clientResourceFile: encontradas=120 migradas=120 omitidas=0 con_error=0 MB=84.10
...
TOTAL: encontradas=860 migradas=860 omitidas=0 con_error=0 MB=612.40
```

- `encontradas`: filas legacy con archivo.
- `migradas` (`a_migrar` en dry-run): subidas, verificadas y actualizadas.
- `omitidas`: la fila cambió mientras corría; no se tocó.
- `con_error`: no se pudo subir o verificar; la fila sigue en la base.

Para migrar sólo algunos campos:
`npm run storage:backfill -- --only=OrderMockup.image,MockupLogo.image`.

## Paso 5: verificar

1. Volvé a correr `npm run storage:backfill -- --dry-run`: tiene que decir
   `TOTAL: encontradas=0`.
2. Abrí en la app un pedido viejo con archivo del cliente, una ronda de diseño
   vieja, un chat con adjuntos, un mockup y la pestaña de plantillas/logos:
   todo tiene que verse igual que antes.
3. En R2 → `emd-archivos` → **Objects** vas a ver los archivos migrados bajo
   `.../backfill/` (por ejemplo
   `orders/client-resources/backfill/order-12-clientResourceFile.pdf`).
4. Opcional, en la base (Render → la DB → PSQL Command):

   ```sql
   SELECT count(*) FROM "Order" WHERE "clientResourceFileData" IS NOT NULL;
   SELECT count(*) FROM "OrderMockup" WHERE "imageData" IS NOT NULL;
   ```

   Tienen que dar 0.

El espacio en Postgres no se libera de inmediato: lo recupera el autovacuum
con el tiempo. Si querés recuperarlo ya, se puede correr `VACUUM` sobre esas
tablas en un horario tranquilo.

## Volver atrás (rollback)

- **Antes del backfill**: poner `STORAGE_DRIVER=db` (o borrar la variable) y
  todo vuelve a funcionar como antes. Los archivos que se subieron a R2
  mientras tanto se siguen leyendo **siempre que las variables `S3_*` sigan
  configuradas**.
- **Después del backfill**: `STORAGE_DRIVER=db` sólo cambia dónde se guardan
  los archivos nuevos. Las filas ya migradas **sólo existen en R2**: para
  leerlas hacen falta las `S3_*`. Si se borran las `S3_*` (o el bucket, o se
  revoca el token), esas filas responden error 500 ("No se pudo leer el
  archivo del almacenamiento"). Las filas legacy siguen funcionando siempre.
- No hay script para traer los archivos de R2 de vuelta a la base. Si alguna
  vez hiciera falta, sería el backfill al revés (leer el objeto, escribir el
  base64 y poner la clave en `null`).

## Notas

- Las claves nuevas son `<carpeta>/<uuid>.<ext>` (por ejemplo
  `chat/attachments/3f1c….png`); las del backfill,
  `<carpeta>/backfill/<modelo>-<id>-<campo>.<ext>`.
- En las rondas de diseño, el archivo "principal" de la ronda
  (`montageFileKey`/`feedbackFileKey`) apunta al **mismo objeto** que su
  primer `DesignRevisionFile` (antes se duplicaba el base64). El backfill, en
  cambio, sube esa copia legacy como objeto aparte.
- Lo que **no** se mueve: la `config` JSON de mockups y plantillas (que puede
  llevar imágenes embebidas como data URL). Sigue en Postgres.
- Los adjuntos del chat no se borran al borrar un pedido: el mensaje sobrevive
  sin la referencia al pedido.
- Huecos conocidos de limpieza (quedan objetos huérfanos en R2, sin efecto
  para el usuario): si se borra una conversación o un mensaje de chat directo
  en la base, o si se borra un pedido por fuera de la API.
