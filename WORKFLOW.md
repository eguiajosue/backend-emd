# Flujo de trabajo — EMD Bordados

Fuente de verdad del circuito de un pedido, acordado con el cliente. Cualquier
cambio de comportamiento en `order.service.ts`, `CreateOrderDialog.tsx` o las
vistas de pedidos debe validarse contra este documento.

## 1. Alta del pedido (Recepción)

Al crear un pedido, Recepción decide primero si **requiere montaje/diseño**.

### 1.a Requiere montaje (`requiresDesign = true`)

- El pedido entra al área **Diseño**.
- La asignación a un diseñador es **obligatoria**: no se puede guardar sin
  elegir. Una de las opciones válidas es **"Cualquier diseñador"**, que se
  materializa asignando el pedido a la **cuenta compartida del área Diseño**
  (`User.isSharedAccount = true` con rol `diseno`), no dejándolo sin asignar.
- El selector muestra **solo diseñadores** (más la cuenta de área). Nunca el
  resto del taller.
- El **área de producción es opcional** en este paso: se puede dejar "sin
  definir" y resolverla más adelante (Recepción o Diseño).
- Cuando el pedido queda en la **cuenta compartida** de Diseño, cualquier
  diseñador puede **tomarlo** con un botón explícito
  (`POST /orders/:id/take-design`): el pedido pasa a estar asignado a él.
  **No** es automático al subir el montaje. Sólo se puede tomar si está en la
  cuenta compartida o sin asignar: si ya lo tiene **otra persona real** se
  rechaza con 400 (no se le roba el pedido a un compañero). Tomar un pedido
  que ya se tenía no es error: es idempotente. **Admin NO puede tomarlo**
  (ver §5): admin genera pedidos, no los trabaja.

### 1.b No requiere montaje (`requiresDesign = false`)

- El **área destino es obligatoria**.
- La asignación por defecto es la **cuenta compartida del área destino**, con
  la opción de abrir el selector y elegir a un **empleado concreto de esa
  área** si se quiere nominar responsable.

### 1.c Cambio de decisión

`requiresDesign` se puede cambiar **después de creado, en ambos sentidos**: un
pedido sin diseño puede derivarse a Diseño, y uno en Diseño puede saltarse el
montaje e ir directo a producción.

### 1.d Qué archivo es cada cosa

Hay **dos archivos distintos** en el circuito y conviene no confundirlos:

| Qué | Quién lo sube | Cuándo | Dónde vive |
|---|---|---|---|
| **Recursos del cliente** (logo, referencias, arte previo) | Recepción | En el alta del pedido, **opcional** | `Order.clientResourceFile*`, se manda como `clientResourceFile` |
| **Hoja de autorización** = el **montaje** | Diseño | En **cada ronda** del ciclo de diseño | `DesignRevision` / `DesignRevisionFile` |

Los recursos del cliente son la **materia prima** para poder hacer el diseño;
la hoja de autorización es lo que Recepción le manda al cliente para que
apruebe. El campo del alta se llamaba `authorizationFile*`, un nombre que
hacía que Recepción subiera ahí la cosa equivocada; se renombró a
`clientResourceFile*` en el código y en la base (migración
`20260911120000_order_attended_by_and_client_resource_file`, con `RENAME
COLUMN` para no perder lo ya cargado).

## 2. Ciclo de diseño

Estados: `en diseño` → `esperando autorización` → (`cambios solicitados` →
`en diseño`)\* → `autorizado`.

- Diseño sube un montaje (ronda N) y el pedido queda **esperando autorización**.
  Una ronda admite **varios archivos**: una o varias imágenes, o un PDF (hasta
  10 archivos, 5MB cada uno y 7MB en total por ronda). Lo mismo vale para el
  adjunto del feedback. El tope agregado es 7MB porque el JSON viaja en base64
  (+33%) y el body-parser corta en 10MB: más que eso devolvería un 413 genérico
  en vez del mensaje explícito. Mandar el campo legacy (`montageFile` /
  `feedbackFile`) **y** el nuevo (`montageFiles` / `feedbackFiles`) a la vez es
  un error: hay que usar uno solo.
- El aviso de **"Diseño mandó la hoja de autorización"** va **solo a una
  recepcionista**, no a todo el rol Recepción: la que **atiende** el pedido
  (ver "Atender un pedido ajeno" abajo). La **visibilidad no cambia**: todo
  Recepción sigue viendo todos los pedidos; lo que se dirige es la
  notificación.
- **Atender un pedido ajeno**: los avisos del circuito iban sólo a la
  recepcionista que **creó** el pedido (`Order.userId`), así que si esa persona
  estaba de franco o enferma el pedido se trababa porque nadie más se
  enteraba. Ahora **otra recepcionista puede TOMAR el pedido**
  (`POST /orders/:id/take-reception`) y se guardan **las dos cosas**: quién lo
  **creó** (`Order.userId`, que **no cambia nunca**) y quién lo **atiende hoy**
  (`Order.attendedByUserId`).
  - **Destinatario efectivo** de todo aviso dirigido "a Recepción" =
    `attendedByUserId ?? userId`. Vale para el aviso de montaje listo, el de
    cada etapa de producción completada y el de pedido listo para entregar.
  - Sigue valiendo que **nadie recibe el aviso de su propia acción**.
  - Tomar un pedido que ya se estaba atendiendo es **idempotente** (no es un
    error), y la toma queda registrada en la **auditoría** del pedido
    (`OrderAuditLog`, acción `reception_taken`).
  - La **visibilidad no cambia**: todo Recepción sigue viendo todos los
    pedidos. Lo único que cambia es a quién le llega el aviso.
- **Quién marca AUTORIZADO**: **solo Recepción** (o admin/superuser). Diseño ya
  no puede autorizar: quien habla con el cliente es Recepción.
- Al autorizar, el pedido se **archiva** (`Order.archivedAt`): **sale del
  tablero activo de Diseño** pero queda en el historial y en las consultas
  generales. El frontend filtra el tablero de Diseño por `archivedAt IS NULL`.
- Cualquier cosa que devuelva el pedido a Diseño lo **desarchiva**
  (`archivedAt = null`): cargar feedback del cliente, abrir una ronda nueva, o
  volver a marcar `requiresDesign = true` desde el PATCH del pedido. Si no,
  llegaría la notificación de un pedido que el tablero no muestra.
- Si el cliente **pide cambios**, el pedido vuelve **al mismo diseñador que
  hizo esa ronda** y el aviso va **a ese diseñador**, no a todo el área;
  Recepción puede **redirigirlo** a otro si esa persona no está disponible.
- Este ciclo de estados es visible **solo para el rol Diseño** (ver §4).

## 3. Autorizado → producción (multi-área)

Un pedido puede requerir **varias áreas de producción** y éstas trabajan **en
paralelo**, no en secuencia.

- **Quién define las áreas participantes**: Recepción al crear el pedido, y/o
  Diseño al autorizar el montaje.
- Cada área participante genera una **tarea de área** con su **propio estado y
  su propio responsable**:
  - Estados de la tarea: **Pendiente → En proceso → Terminado**. Sólo se
    avanza (o se retrocede) de a un paso; cualquier otro salto se rechaza con
    400. Si un área **retrocede** desde Terminado y el pedido ya estaba "listo
    para entregar", el pedido vuelve a **autorizado**.
  - Asignación por defecto: la **cuenta compartida de esa área**; cualquiera
    del área puede tomarla. **Empezar es tomar**: al pasar la tarea a "en
    proceso", si estaba sin asignar o en la cuenta del área, queda a nombre de
    quien la arrancó — **sólo si quien la arranca es del área**: Recepción y
    admin pueden mover el estado de cualquier tarea, pero no se la quedan (si
    no, el área perdería su bandeja).
- El **diseñador deja de ser el responsable** al pasar a producción, pero queda
  registrado en el **historial/auditoría** del pedido y en las rondas de
  montaje.
- **Cierre**: cuando **todas** las tareas de área quedan en Terminado, el
  pedido pasa automáticamente a **listo para entregar**; la **entrega la
  confirma Recepción** manualmente. Marcar **ENTREGADO** está restringido a
  Recepción/admin/superuser, tanto en `PATCH /orders/:id` como en las acciones
  masivas: producción termina su tarea, pero no cierra el pedido.
- Si se **quita la última área** de un pedido que ya estaba "listo para
  entregar", el pedido vuelve a **autorizado**: sin tareas no hay nada
  terminado.

### Notificaciones

- Una notificación **por tarea de área**, dirigida **solo al área que le toca**.
- El aviso de **cada etapa completada** y el de **pedido terminado / listo para
  entregar** van **solo a la recepcionista que atiende el pedido**
  (`attendedByUserId ?? userId`, ver §2), no a todo el rol Recepción. Si quien
  hace la acción es esa misma persona, **no recibe aviso de sí misma** (vale
  también para el aviso de montaje listo).

## 4. Vistas por rol

- El **ciclo de diseño se muestra únicamente a los diseñadores**.
- Un usuario que tenga rol de diseñador **y además** un rol de producción puede
  **alternar entre la vista de Diseño y la de Producción**.
- **No** hay una vista por cada área de producción. La vista de producción es
  **unificada**: muestra todas las tareas juntas, **etiquetando de qué área es
  cada una**.
- Un empleado ve **solo las tareas de sus propias áreas** (si es bordador y
  laserista, ve Bordado y Láser mezcladas y etiquetadas; nada de otras áreas).
- En **Configuración** hay una preferencia **personal de cada usuario** para
  ver **todo junto** o **vistas separadas por área**. No la impone el admin.

## 5. Permisos de reasignación

Pueden reasignar un pedido/tarea **a otra persona** (rol de manager):

- **Recepción**
- **Admin / superuser**
- **El propio empleado**, para tomarse una tarea que está en la cuenta de área

**Tomar un pedido para sí mismo y trabajarlo** es otra cosa, y **admin queda
afuera a propósito**: admin genera pedidos, no los trabaja. El único rol que
puede hacer de todo (incluido tomar) es **superuser**.

- **Cualquier diseñador (o superuser)**, para tomarse un pedido que está en la
  cuenta compartida de Diseño (`POST /orders/:id/take-design`); nunca uno que
  ya tiene otra persona. `@Auth(DISENO, SUPERUSER)` — sin `ADMIN`.
- **Cualquier recepcionista (o superuser)**, para pasar a atender un pedido
  que dio de alta otra (`POST /orders/:id/take-reception`); el creador del
  pedido no cambia. `@Auth(RECEPCION, SUPERUSER)` — sin `ADMIN`.

## 6. Plan de implementación (3 fases)

Estado: **las 3 fases están implementadas.**

1. **Fase 1 — Flujo de Diseño** ✅: asignación obligatoria a diseñador (con
   "Cualquier diseñador" = cuenta de área), selector filtrado por rol,
   `requiresDesign` editable después, retorno al diseñador en "cambios
   solicitados" con redirección por Recepción, diseñador preservado en el
   historial.
2. **Fase 2 — Multi-área** ✅: modelo de tareas de área (estado + responsable por
   área), creación de tareas al crear/autorizar, cierre automático a "listo
   para entregar", entrega manual por Recepción, notificaciones por tarea.
3. **Fase 3 — Vistas** ✅: vista de Diseño vs Producción, vista unificada
   etiquetada por área, alternancia para roles mixtos y preferencia personal en
   Configuración.

Los pedidos existentes no tienen datos que preservar: la migración a tareas de
área puede hacerse sin cuidados especiales.

## 7. Dónde vive cada cosa

| Pieza | Archivo |
|---|---|
| Tareas de área (lógica) | `src/order/order-area-task.service.ts` |
| Endpoints de tareas | `src/order/order.controller.ts` (`/orders/:id/area-tasks`, `/orders/my-area-tasks`) |
| Modelo | `prisma/schema.prisma` → `OrderAreaTask`, enum `AreaTaskStatus` |
| Validación de asignación por área | `OrderService.assertUserBelongsToArea` |
| Preferencia de vista | `User.areaViewMode` (`'unified' \| 'split'`) |
| Bandeja del usuario (frontend) | `src/app/dashboard/orders/page.tsx` (`mi-trabajo/page.tsx` es hoy sólo un redirect) |
| Archivos de una ronda de diseño | `prisma/schema.prisma` → `DesignRevisionFile`; `GET /orders/:id/design-revisions/:revisionId/files/:fileId` |
| Archivado al autorizar | `Order.archivedAt`, seteado en `OrderService.approveDesignRevision` |
| Áreas en el detalle del pedido | `src/components/orders/AreaTasksSection.tsx` |
| Atender un pedido (Recepción) | `Order.attendedByUserId`; `POST /orders/:id/take-reception` → `OrderService.takeReception` |
| Destinatario efectivo de los avisos a Recepción | `OrderService.receptionOwnerIdOf` y `OrderAreaTaskService.orderReceptionOwnerId` |
| Tomar un pedido (Diseño) | `POST /orders/:id/take-design` → `OrderService.takeDesign` |
| Recursos que manda el cliente en el alta | `Order.clientResourceFile*`; `CreateOrderDto.clientResourceFile`; se devuelve en `GET /orders/:id` como `clientResourceFile` y en los listados como `hasClientResourceFile` |
