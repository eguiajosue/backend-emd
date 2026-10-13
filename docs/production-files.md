# Archivos de producción (Diseño → producción)

Diseño sube el archivo final (`.zip .eps .svg .dxf .ai .pdf .jpg .jpeg .png`,
hasta 5 GB) y las áreas de producción (Impresiones, Láser, ...) lo descargan.
**Los bytes nunca pasan por el backend**: el navegador sube por partes (multipart)
directo a R2 con URLs firmadas, y descarga igual.

Requiere `STORAGE_DRIVER=s3` (ver `storage-r2.md`); con `db` los endpoints
responden 503.

## Flujo
1. `POST /orders/:id/production-files/uploads` `{ fileName, mimeType, sizeBytes, notes? }`
   → `{ fileId, partSize (64 MiB), partCount, parts: [{ partNumber, url }] }`.
2. El navegador hace `PUT` de cada parte a su URL y lee el header `ETag`.
3. `POST .../uploads/:fileId/parts` `{ partNumbers }` re-firma partes (expiran a 1 h).
4. `POST .../uploads/:fileId/complete` `{ parts: [{ partNumber, etag }] }`
   → el backend cierra el multipart y verifica el tamaño real contra el declarado.
5. `GET .../production-files` lista; `GET .../:fileId/download` → `{ url, fileName }`
   (URL firmada de 15 min, con `Content-Disposition: attachment`; queda en el audit log).
6. `DELETE .../uploads/:fileId` cancela una subida; `DELETE .../:fileId` borra un archivo listo.

Permisos: suben/borran `diseno`, `recepcion`, `admin`, `superuser` (borrar: quien lo
subió o admin). Descargan los que pueden ver el pedido (`assertOrderAccess`).
Una tarea horaria aborta las subidas `uploading` de más de 24 h.

## Configuración del bucket R2 (una vez)
**CORS** (Bucket → Settings → CORS policy), con el dominio real de Vercel:

```json
[
  {
    "AllowedOrigins": ["https://TU-APP.vercel.app", "http://localhost:3000"],
    "AllowedMethods": ["GET", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`ExposeHeaders: ETag` es imprescindible: sin él el navegador no puede leer el
ETag de cada parte y no se puede completar la subida.

**Lifecycle**: regla "Abort incomplete multipart uploads" a 1 día.
