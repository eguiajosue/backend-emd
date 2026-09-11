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

### 1.b No requiere montaje (`requiresDesign = false`)

- El **área destino es obligatoria**.
- La asignación por defecto es la **cuenta compartida del área destino**, con
  la opción de abrir el selector y elegir a un **empleado concreto de esa
  área** si se quiere nominar responsable.

### 1.c Cambio de decisión

`requiresDesign` se puede cambiar **después de creado, en ambos sentidos**: un
pedido sin diseño puede derivarse a Diseño, y uno en Diseño puede saltarse el
montaje e ir directo a producción.

## 2. Ciclo de diseño

Estados: `en diseño` → `esperando autorización` → (`cambios solicitados` →
`en diseño`)\* → `autorizado`.

- Diseño sube un montaje (ronda N) y el pedido queda **esperando autorización**.
  Una ronda admite **varios archivos**: una o varias imágenes, o un PDF (hasta
  10 archivos, 5MB cada uno y 20MB en total por ronda). Lo mismo vale para el
  adjunto del feedback.
- El aviso de **"Diseño mandó la hoja de autorización"** va **solo a la
  recepcionista que creó el pedido** (`Order.userId`), no a todo el rol
  Recepción. La **visibilidad no cambia**: todo Recepción sigue viendo todos
  los pedidos; lo que se dirige es la notificación.
- **Quién marca AUTORIZADO**: **solo Recepción** (o admin/superuser). Diseño ya
  no puede autorizar: quien habla con el cliente es Recepción.
- Al autorizar, el pedido se **archiva** (`Order.archivedAt`): **sale del
  tablero activo de Diseño** pero queda en el historial y en las consultas
  generales. El frontend filtra el tablero de Diseño por `archivedAt IS NULL`.
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
    quien la arrancó.
- El **diseñador deja de ser el responsable** al pasar a producción, pero queda
  registrado en el **historial/auditoría** del pedido y en las rondas de
  montaje.
- **Cierre**: cuando **todas** las tareas de área quedan en Terminado, el
  pedido pasa automáticamente a **listo para entregar**; la **entrega la
  confirma Recepción** manualmente. Marcar **ENTREGADO** está restringido a
  Recepción/admin/superuser, tanto en `PATCH /orders/:id` como en las acciones
  masivas: producción termina su tarea, pero no cierra el pedido.

### Notificaciones

- Una notificación **por tarea de área**, dirigida **solo al área que le toca**.
- El aviso de **cada etapa completada** y el de **pedido terminado / listo para
  entregar** van **solo a la recepcionista que creó el pedido**
  (`Order.userId`), no a todo el rol Recepción.

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

Pueden reasignar un pedido/tarea:

- **Recepción**
- **Admin / superuser**
- **El propio empleado**, para tomarse una tarea que está en la cuenta de área

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
