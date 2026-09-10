# Chat: checks de entrega/lectura + presencia (backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Exponer los tres datos que el frontend necesita para las burbujas
estilo WhatsApp: checks de entrega/lectura (✓/✓✓/✓✓ azul), indicador de
"escribiendo…", y presencia ("en línea"/"última vez"). Ningún cambio de UI en
este plan — es la mitad de backend de la Fase 4 del rediseño (frontend va en
un plan aparte, en `frontend-emd`, que consume estas interfaces).

**Architecture:** `ChatConversationMember.lastReadAt` ya existe y ya alimenta
`unreadCount` — se reutiliza tal cual para el check de leído. Se agrega
`deliveredAt` a la misma tabla (mismo patrón) para el check de entregado, y
`lastSeenAt` a `User` para "última vez". El gateway de sockets
(`NotificationsGateway`), hoy unidireccional (emite, nunca escucha), gana tres
listeners (`chatDelivered`, `chatTyping`, `chatStopTyping`) que validan la
membresía del emisor contra la base de datos antes de reemitir — nunca
confían en el `conversationId` del cliente a ciegas. Para evitar dependencia
circular entre `ChatModule` y `NotificationsModule` (`ChatService` ya inyecta
`NotificationsGateway`), el gateway valida membresía con una consulta directa
a `PrismaService` (inyectado nuevo en el gateway), no reinyectando
`ChatService`.

**Tech Stack:** NestJS, Prisma, Socket.IO, Jest (mocks manuales de Prisma, sin
DB real — mismo patrón que `chat.service.spec.ts`).

**Spec:** sección 6.6 de
`docs/superpowers/specs/2026-09-10-frontend-ios-responsive-design.md` (en el
repo `frontend-emd`) — ese documento tiene el diseño completo; este plan lo
traduce a tareas ejecutables contra el estado real del código.

## Global Constraints

- No hay base de datos local disponible en este entorno. CI tampoco corre
  contra una DB real (`.github/workflows/ci.yml`: sólo `prisma generate`,
  lint, build, test — ningún `prisma migrate`). La migración se escribe a
  mano en el formato exacto que genera Prisma, y se valida con
  `npx prisma validate` + `npx prisma generate` (ninguno de los dos toca una
  DB), nunca con `prisma migrate dev`.
- Ningún listener de socket nuevo confía en el payload del cliente: todo
  `conversationId` recibido se valida contra `ChatConversationMember` antes
  de reemitir cualquier cosa.
- No tocar el frontend (`frontend-emd`) en este plan — es un repo aparte con
  su propio plan.
- Sin dependencias nuevas.
- Tests con Jest, mocks manuales de `PrismaService` (objetos planos con
  `jest.fn()`), siguiendo el patrón de `src/chat/chat.service.spec.ts`.
  Español en comentarios y mensajes.

---

### Task 1: Migración + columnas nuevas

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<TIMESTAMP>_add_chat_delivered_presence/migration.sql`
- Test: ninguno (cambio de esquema, sin lógica propia — se verifica con
  `prisma validate`/`prisma generate`, cubierto en Step 3)

**Interfaces:**
- Produces: `ChatConversationMember.deliveredAt: DateTime?` y
  `User.lastSeenAt: DateTime?`, consumidos por las Tasks 2 y 3.

- [ ] **Step 1: Agregar las columnas al schema**

En `prisma/schema.prisma`, el modelo `ChatConversationMember` (alrededor de
la línea 369-382) hoy es:

```prisma
model ChatConversationMember {
  id             Int       @id @default(autoincrement()) // Identificador único de la membresía.
  conversationId Int // Clave foránea que referencia a ChatConversation.
  userId         Int // Clave foránea que referencia al User miembro.
  isMonitor      Boolean   @default(false) // true para admin/superuser: participan para monitoreo, visible en la lista de participantes.
  lastReadAt     DateTime? // Fecha del último mensaje leído por este usuario en la conversación.
  joinedAt       DateTime  @default(now()) // Fecha en que se materializó la membresía.

  conversation ChatConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  user         User             @relation(fields: [userId], references: [id])

  @@unique([conversationId, userId])
  @@index([userId])
}
```

Agregar `deliveredAt` junto a `lastReadAt`:

```prisma
model ChatConversationMember {
  id             Int       @id @default(autoincrement()) // Identificador único de la membresía.
  conversationId Int // Clave foránea que referencia a ChatConversation.
  userId         Int // Clave foránea que referencia al User miembro.
  isMonitor      Boolean   @default(false) // true para admin/superuser: participan para monitoreo, visible en la lista de participantes.
  lastReadAt     DateTime? // Fecha del último mensaje leído por este usuario en la conversación.
  deliveredAt    DateTime? // Última vez que el cliente de este usuario confirmó tener la conexión viva (usado para el check "entregado" — ver NotificationsGateway).
  joinedAt       DateTime  @default(now()) // Fecha en que se materializó la membresía.

  conversation ChatConversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  user         User             @relation(fields: [userId], references: [id])

  @@unique([conversationId, userId])
  @@index([userId])
}
```

En el modelo `User` (línea 43 en adelante), buscar el bloque de campos
escalares (antes de las relaciones, cerca de `isSharedAccount`) y agregar:

```prisma
  isSharedAccount Boolean @default(false) // Cuenta compartida por varias personas de un área (ej. "Taller"), en vez de una persona.
  lastSeenAt      DateTime? // Última vez que se desconectó el último socket vivo de este usuario (ver NotificationsGateway.handleDisconnect). Null si nunca se conectó por WebSocket.
```

- [ ] **Step 2: Escribir la migración a mano**

Determinar el timestamp: usar la fecha/hora actual en formato
`YYYYMMDDHHmmss` (mismo formato que las carpetas existentes en
`prisma/migrations/`, ej. `20260910012727_add_expo_push_token`). Crear la
carpeta `prisma/migrations/<TIMESTAMP>_add_chat_delivered_presence/` con un
archivo `migration.sql`:

```sql
-- AlterTable
ALTER TABLE "ChatConversationMember" ADD COLUMN "deliveredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN "lastSeenAt" TIMESTAMP(3);
```

(Dos columnas nulables sin default: no requieren backfill ni afectan filas
existentes.)

- [ ] **Step 3: Validar sin DB**

Run: `cd /home/user/backend-emd && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀` (o mensaje
equivalente de éxito).

Run: `npx prisma generate`
Expected: termina sin errores, regenera el client de Prisma con los campos
nuevos.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(chat): agrega deliveredAt y lastSeenAt para checks y presencia"
```

---

### Task 2: `ChatService` — exponer los datos y emitir `chatRead`

**Files:**
- Modify: `src/chat/chat.service.ts`
- Modify: `src/notifications/notifications.gateway.ts` (agregar el método
  `emitChatRead`, usado por esta tarea — ver Interfaces)
- Test: `src/chat/chat.service.spec.ts` (extender)

**Interfaces:**
- Consumes: `deliveredAt` (Task 1) en `ChatConversationMember`; `lastSeenAt`
  (Task 1) en `User`.
- Produces:
  - `findMembers(conversationId, user)` ahora devuelve, por cada miembro,
    además de `{id, username, firstName, lastName, isMonitor}`:
    `{lastReadAt: Date | null, deliveredAt: Date | null, isOnline: boolean, lastSeenAt: Date | null}`.
  - `findChatUsers(user)` ahora incluye `isOnline: boolean` y
    `lastSeenAt: Date | null` por usuario (para mostrar presencia en el
    selector de "Nuevo mensaje directo").
  - Nuevo método público en `NotificationsGateway`:
    `emitChatRead(userIds: number[], payload: { conversationId: number; userId: number; lastReadAt: Date }): void` —
    Task 3 no lo toca, pero debe existir antes de que esta tarea compile.
  - Nuevo método público en `NotificationsGateway`:
    `isUserOnline(userId: number): boolean` — consulta el tamaño de la room
    `user:<id>` en el servidor de sockets. Devuelve `false` si el gateway
    todavía no tiene servidor inicializado (por ejemplo, en tests que no
    levantan el socket real).

**Contexto para quien implemente:** `findMembers` y `findChatUsers` hoy no
reciben el gateway — hay que inyectarlo en el constructor de `ChatService`
(ya está inyectado, se usa en otros métodos) y llamarlo para resolver
`isOnline`. La regla de "leído" para el check azul en un canal de área es:
todos los miembros NO monitores, EXCLUYENDO al emisor del mensaje, tienen
`lastReadAt >= message.createdAt`. Esa comparación la hace el FRONTEND (tiene
la lista de miembros con sus `lastReadAt`/`deliveredAt` y la lista de
mensajes) — este backend sólo expone los datos crudos, no calcula el
check por mensaje.

- [ ] **Step 1: Agregar `emitChatRead` e `isUserOnline` a `NotificationsGateway`**

En `src/notifications/notifications.gateway.ts`, agregar después de
`emitChatMessage` (línea 287-294):

```ts
  /**
   * Alguien marcó la conversación como leída: se avisa a los DEMÁS
   * miembros (no al que la marcó) para que actualicen el check de lectura
   * de sus propios mensajes en tiempo real.
   */
  emitChatRead(
    userIds: number[],
    payload: { conversationId: number; userId: number; lastReadAt: Date },
  ) {
    userIds.forEach((userId) => {
      this.server.to(`user:${userId}`).emit('chatRead', payload);
    });
  }

  /**
   * true si el usuario tiene al menos un socket vivo en su room individual.
   * `this.server` puede no estar listo en tests unitarios que instancian el
   * gateway sin levantar un servidor real — se devuelve `false` en ese caso
   * en vez de tirar.
   */
  isUserOnline(userId: number): boolean {
    const room = this.server?.sockets?.adapter?.rooms?.get(`user:${userId}`);
    return !!room && room.size > 0;
  }
```

- [ ] **Step 2: Extender `findMembers` en `ChatService`**

En `src/chat/chat.service.ts`, el método `findMembers` (línea 273-288) hoy
es:

```ts
  /** Participantes de una conversación, con el indicador de monitoreo. */
  async findMembers(conversationId: number, user: ChatRequestingUser) {
    const conversation = await this.assertConversationAccess(
      conversationId,
      user,
    );
    const members = await this.syncMembers(conversation);
    const users = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: USER_SUMMARY_SELECT,
    });
    const monitorById = new Map(members.map((m) => [m.userId, m.isMonitor]));
    return users.map((u) => ({
      ...u,
      isMonitor: monitorById.get(u.id) ?? false,
    }));
  }
```

Cambiarlo a:

```ts
  /**
   * Participantes de una conversación, con el indicador de monitoreo y los
   * datos de checks/presencia que necesita el frontend: `lastReadAt` y
   * `deliveredAt` por miembro (para calcular ✓/✓✓/✓✓ azul en el cliente),
   * `isOnline`/`lastSeenAt` (para el header del hilo).
   */
  async findMembers(conversationId: number, user: ChatRequestingUser) {
    const conversation = await this.assertConversationAccess(
      conversationId,
      user,
    );
    const members = await this.syncMembers(conversation);
    const memberRows = await this.prisma.chatConversationMember.findMany({
      where: { conversationId, userId: { in: members.map((m) => m.userId) } },
      select: { userId: true, lastReadAt: true, deliveredAt: true },
    });
    const rowByUserId = new Map(memberRows.map((r) => [r.userId, r]));
    const users = await this.prisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { ...USER_SUMMARY_SELECT, lastSeenAt: true },
    });
    const monitorById = new Map(members.map((m) => [m.userId, m.isMonitor]));
    return users.map((u) => {
      const row = rowByUserId.get(u.id);
      const { lastSeenAt, ...userSummary } = u;
      return {
        ...userSummary,
        isMonitor: monitorById.get(u.id) ?? false,
        lastReadAt: row?.lastReadAt ?? null,
        deliveredAt: row?.deliveredAt ?? null,
        isOnline: this.notificationsGateway.isUserOnline(u.id),
        lastSeenAt,
      };
    });
  }
```

- [ ] **Step 3: Extender `findChatUsers`**

El método (línea 704-717) hoy es:

```ts
  /** Usuarios con los que se puede abrir un mensaje directo. */
  async findChatUsers(user: ChatRequestingUser) {
    const users = await this.prisma.user.findMany({
      where: { id: { not: user.userId } },
      select: { ...USER_SUMMARY_SELECT, roles: { select: { name: true } } },
      orderBy: [{ firstName: 'asc' }, { username: 'asc' }],
    });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      roles: u.roles.map((r) => r.name),
    }));
  }
```

Cambiarlo a:

```ts
  /** Usuarios con los que se puede abrir un mensaje directo. */
  async findChatUsers(user: ChatRequestingUser) {
    const users = await this.prisma.user.findMany({
      where: { id: { not: user.userId } },
      select: {
        ...USER_SUMMARY_SELECT,
        roles: { select: { name: true } },
        lastSeenAt: true,
      },
      orderBy: [{ firstName: 'asc' }, { username: 'asc' }],
    });
    return users.map((u) => ({
      id: u.id,
      username: u.username,
      firstName: u.firstName,
      lastName: u.lastName,
      roles: u.roles.map((r) => r.name),
      isOnline: this.notificationsGateway.isUserOnline(u.id),
      lastSeenAt: u.lastSeenAt,
    }));
  }
```

- [ ] **Step 4: Emitir `chatRead` desde `markConversationAsRead`**

El método (línea 677-691) hoy es:

```ts
  /** Marca como leída la conversación hasta el instante actual. */
  async markConversationAsRead(
    conversationId: number,
    user: ChatRequestingUser,
  ) {
    const conversation = await this.assertConversationAccess(
      conversationId,
      user,
    );
    await this.syncMembers(conversation);
    await this.prisma.chatConversationMember.updateMany({
      where: { conversationId, userId: user.userId },
      data: { lastReadAt: new Date() },
    });
    return { message: 'Conversación marcada como leída' };
  }
```

Cambiarlo a:

```ts
  /** Marca como leída la conversación hasta el instante actual. */
  async markConversationAsRead(
    conversationId: number,
    user: ChatRequestingUser,
  ) {
    const conversation = await this.assertConversationAccess(
      conversationId,
      user,
    );
    const members = await this.syncMembers(conversation);
    const lastReadAt = new Date();
    await this.prisma.chatConversationMember.updateMany({
      where: { conversationId, userId: user.userId },
      data: { lastReadAt },
    });
    const otherMemberIds = members
      .map((m) => m.userId)
      .filter((id) => id !== user.userId);
    this.notificationsGateway.emitChatRead(otherMemberIds, {
      conversationId,
      userId: user.userId,
      lastReadAt,
    });
    return { message: 'Conversación marcada como leída' };
  }
```

- [ ] **Step 5: Escribir/extender los tests**

Agregar a `src/chat/chat.service.spec.ts` (seguir el patrón existente del
archivo: `prisma` es un objeto plano con `jest.fn()`, `gateway` idem). En el
mock de `gateway` (línea ~37,
`gateway: { emitChatMessage: jest.Mock }`), agregar los métodos nuevos:

```ts
  let gateway: {
    emitChatMessage: jest.Mock;
    emitChatRead: jest.Mock;
    isUserOnline: jest.Mock;
  };
```

Y en su inicialización en `beforeEach` (buscar dónde se arma `gateway = {`),
agregar:

```ts
    gateway = {
      emitChatMessage: jest.fn(),
      emitChatRead: jest.fn(),
      isUserOnline: jest.fn().mockReturnValue(false),
    };
```

Agregar el mock de `lastSeenAt` en las filas de usuario que ya arma el
archivo (donde arma los objetos de `prisma.user.findMany`), y agregar al
mock de `prisma.chatConversationMember` un `findMany` (el archivo ya tiene
`deleteMany`/`upsert`/`updateMany`/`findUnique`; agregarle
`findMany: jest.fn().mockResolvedValue([])` como default, y sobreescribirlo
por test donde haga falta).

Agregar estos tests nuevos al final del archivo (mismo `describe` block o
uno nuevo, seguir el estilo existente — `describe`/`it` en español):

```ts
describe('ChatService - checks y presencia', () => {
  // Reusar el mismo setup de beforeEach que el resto del archivo (prisma,
  // gateway, orderService, chatService instanciados igual).

  it('findMembers incluye lastReadAt, deliveredAt e isOnline por miembro', async () => {
    prisma.chatConversationMember.findMany = jest.fn().mockResolvedValue([
      { userId: 10, lastReadAt: new Date('2026-01-02'), deliveredAt: new Date('2026-01-01') },
    ]);
    prisma.user.findMany = jest.fn().mockResolvedValue([
      { id: 10, username: 'ana', firstName: 'Ana', lastName: 'Gómez', lastSeenAt: null },
    ]);
    gateway.isUserOnline.mockReturnValue(true);

    const result = await chatService.findMembers(3, { userId: 11, roles: [] });

    expect(result[0]).toMatchObject({
      id: 10,
      lastReadAt: new Date('2026-01-02'),
      deliveredAt: new Date('2026-01-01'),
      isOnline: true,
      lastSeenAt: null,
    });
  });

  it('markConversationAsRead emite chatRead a los demás miembros, no a quien marcó', async () => {
    await chatService.markConversationAsRead(3, { userId: 10, roles: [] });

    expect(gateway.emitChatRead).toHaveBeenCalledTimes(1);
    const [userIds, payload] = gateway.emitChatRead.mock.calls[0];
    expect(userIds).not.toContain(10);
    expect(payload).toMatchObject({ conversationId: 3, userId: 10 });
    expect(payload.lastReadAt).toBeInstanceOf(Date);
  });
});
```

Ajustar los mocks de `resolveMembers`/`syncMembers` según haga falta para
que el segundo test tenga al menos un miembro además del 10 (revisar cómo
el archivo ya mockea `prisma.user.findMany` para el cálculo de miembros del
canal `3` — es el DM entre 10 y 11 definido en `CONVERSATIONS` al inicio del
archivo, así que `resolveMembers` ya debería devolver `[10, 11]` sin mocks
adicionales).

- [ ] **Step 6: Correr los tests**

Run: `cd /home/user/backend-emd && npm run test -- chat.service.spec.ts`
Expected: todos los tests pasan, incluidos los dos nuevos.

- [ ] **Step 7: Build y lint**

Run: `npm run build`
Expected: sin errores de TypeScript.

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add src/chat/chat.service.ts src/chat/chat.service.spec.ts src/notifications/notifications.gateway.ts
git commit -m "feat(chat): expone lastReadAt/deliveredAt/isOnline y emite chatRead"
```

---

### Task 3: `NotificationsGateway` — presencia y listeners de entrega/escritura

**Files:**
- Modify: `src/notifications/notifications.gateway.ts`
- Modify: `src/notifications/notifications.module.ts`
- Test: `src/notifications/notifications.gateway.spec.ts` (nuevo)

**Interfaces:**
- Consumes: `emitChatRead`/`isUserOnline` de la Task 2 (no los modifica).
- Produces: nada que otra tarea de este plan consuma — es la última tarea.
  El frontend (plan aparte) consume: eventos `chatDelivered`,
  `chatTyping`/`chatStopTyping` (emitidos y escuchados), `presenceChanged`
  (emitido en connect/disconnect).

**Contexto para quien implemente:** hoy `handleDisconnect` no sabe qué
usuario se desconectó (`client.data` nunca se llena). Sin eso no se puede
escribir `lastSeenAt` ni saber si hay que emitir `presenceChanged`. La regla
de "última vez" es: sólo se escribe cuando el ÚLTIMO socket vivo de ese
usuario se desconecta (si tiene dos pestañas abiertas y cierra una, sigue
"en línea"). `NotificationsModule` necesita importar `PrismaModule` para
poder inyectar `PrismaService` en el gateway (no se reinyecta `ChatService`,
para evitar el ciclo `ChatModule` ↔ `NotificationsModule` que ya existe:
`ChatModule` importa `NotificationsModule`).

- [ ] **Step 1: Importar `PrismaModule` en `NotificationsModule`**

`src/notifications/notifications.module.ts` hoy es:

```ts
import { Module } from '@nestjs/common';
import { NotificationsGateway } from './notifications.gateway';

@Module({
  imports: [],
  controllers: [],
  providers: [NotificationsGateway],
  exports: [NotificationsGateway],
})
export class NotificationsModule {}
```

Cambiarlo a:

```ts
import { Module } from '@nestjs/common';
import { NotificationsGateway } from './notifications.gateway';
import { PrismaModule } from 'src/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [],
  providers: [NotificationsGateway],
  exports: [NotificationsGateway],
})
export class NotificationsModule {}
```

- [ ] **Step 2: Inyectar `PrismaService` en el gateway**

En `src/notifications/notifications.gateway.ts`, agregar el import (junto a
los demás imports del archivo):

```ts
import { PrismaService } from '../prisma/prisma.service';
```

Cambiar el constructor (línea 103):

```ts
  constructor(private readonly configService: ConfigService) {}
```

a:

```ts
  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}
```

- [ ] **Step 3: Guardar el userId en `client.data` al conectar**

En `handleConnection` (línea 109-163), dentro del bloque `try` donde ya se
resuelve `decoded` y se hacen los `client.join(...)` (líneas 148-157), justo
después de `client.join(\`user:${decoded.sub}\`)`, agregar:

```ts
      client.data.userId = decoded.sub;
```

Después del bloque `try/catch` completo (es decir, ya confirmado que la
conexión es válida y las rooms se unieron), antes de que termine
`handleConnection`, emitir presencia. El final del método hoy es:

```ts
      this.logger.log(
        `Client connected: ${decoded.username} with roles ${roles.join(', ')}`,
      );
    } catch (error) {
      this.logger.error(`Client disconnected: Invalid token`, error.message);
      client.disconnect();
      return;
    }
  }
```

Cambiarlo a (agregando el aviso de presencia y volviendo `handleConnection`
`async` porque ahora consulta la DB):

```ts
      this.logger.log(
        `Client connected: ${decoded.username} with roles ${roles.join(', ')}`,
      );

      // Sólo el PRIMER socket vivo de este usuario dispara "en línea": si ya
      // tenía otra pestaña conectada, no hace falta volver a avisar.
      const room = this.server.sockets.adapter.rooms.get(
        `user:${decoded.sub}`,
      );
      if (room && room.size === 1) {
        this.server.emit('presenceChanged', {
          userId: decoded.sub,
          online: true,
          lastSeenAt: null,
        });
      }
    } catch (error) {
      this.logger.error(`Client disconnected: Invalid token`, error.message);
      client.disconnect();
      return;
    }
  }
```

Y cambiar la firma del método:

```ts
  handleConnection(client: Socket) {
```

a:

```ts
  async handleConnection(client: Socket) {
```

- [ ] **Step 4: `handleDisconnect` escribe `lastSeenAt` y avisa presencia**

El método (línea 165-167) hoy es:

```ts
  handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);
  }
```

Cambiarlo a:

```ts
  async handleDisconnect(client: Socket) {
    this.logger.log(`Client disconnected: ${client.id}`);

    const userId = client.data?.userId as number | undefined;
    if (userId == null) return;

    // Socket.io ya sacó a este cliente de sus rooms en este punto: si la
    // room del usuario queda vacía, era su último socket vivo.
    const room = this.server.sockets.adapter.rooms.get(`user:${userId}`);
    if (room && room.size > 0) return;

    const lastSeenAt = new Date();
    try {
      await this.prisma.user.update({
        where: { id: userId },
        data: { lastSeenAt },
      });
    } catch (error) {
      // Igual que el resto del gateway: un fallo acá no debe tirar la
      // desconexión. Se loguea y se sigue.
      this.logger.error(
        `No se pudo guardar lastSeenAt para el usuario ${userId}`,
        error.message,
      );
    }
    this.server.emit('presenceChanged', { userId, online: false, lastSeenAt });
  }
```

- [ ] **Step 5: Agregar el helper privado de validación de membresía**

Agregar, antes de `emitChatMessage` (o en cualquier lugar dentro de la
clase, como método privado), un helper reusado por los tres listeners
nuevos:

```ts
  /**
   * Verifica que `userId` sea miembro de `conversationId` antes de dejarlo
   * disparar un evento en tiempo real hacia esa conversación. Nunca se
   * confía en el `conversationId` que manda el cliente sin esta validación
   * server-side.
   */
  private async isConversationMember(
    conversationId: number,
    userId: number,
  ): Promise<boolean> {
    if (!Number.isInteger(conversationId) || !Number.isInteger(userId)) {
      return false;
    }
    const membership = await this.prisma.chatConversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    return !!membership;
  }
```

- [ ] **Step 6: Listener `chatDelivered`**

Agregar el import de `SubscribeMessage` y `MessageBody`/`ConnectedSocket` de
`@nestjs/websockets` (extender el import existente en la línea 1-7):

```ts
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
```

Agregar el método (después de `emitChatMessage`, o donde ordene mejor con
los demás):

```ts
  /**
   * El cliente confirma haber recibido un mensaje de una conversación
   * (dispara al recibir `chatMessage`). Actualiza `deliveredAt` de SU PROPIA
   * membresía y avisa a los demás miembros para que actualicen el check de
   * entrega de sus mensajes salientes.
   */
  @SubscribeMessage('chatDelivered')
  async handleChatDelivered(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: number },
  ) {
    const userId = client.data?.userId as number | undefined;
    const conversationId = body?.conversationId;
    if (userId == null || conversationId == null) return;
    if (!(await this.isConversationMember(conversationId, userId))) return;

    const deliveredAt = new Date();
    await this.prisma.chatConversationMember.updateMany({
      where: { conversationId, userId },
      data: { deliveredAt },
    });

    const others = await this.prisma.chatConversationMember.findMany({
      where: { conversationId, userId: { not: userId } },
      select: { userId: true },
    });
    others.forEach(({ userId: otherId }) => {
      this.server
        .to(`user:${otherId}`)
        .emit('chatDelivered', { conversationId, userId, deliveredAt });
    });
  }
```

- [ ] **Step 7: Listeners `chatTyping`/`chatStopTyping`**

Agregar, junto al anterior:

```ts
  @SubscribeMessage('chatTyping')
  async handleChatTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: number },
  ) {
    await this.relayTypingEvent('chatTyping', client, body);
  }

  @SubscribeMessage('chatStopTyping')
  async handleChatStopTyping(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { conversationId?: number },
  ) {
    await this.relayTypingEvent('chatStopTyping', client, body);
  }

  private async relayTypingEvent(
    event: 'chatTyping' | 'chatStopTyping',
    client: Socket,
    body: { conversationId?: number },
  ) {
    const userId = client.data?.userId as number | undefined;
    const conversationId = body?.conversationId;
    if (userId == null || conversationId == null) return;
    if (!(await this.isConversationMember(conversationId, userId))) return;

    const others = await this.prisma.chatConversationMember.findMany({
      where: { conversationId, userId: { not: userId } },
      select: { userId: true },
    });
    others.forEach(({ userId: otherId }) => {
      this.server.to(`user:${otherId}`).emit(event, { conversationId, userId });
    });
  }
```

- [ ] **Step 8: Escribir los tests del gateway**

Crear `src/notifications/notifications.gateway.spec.ts`:

```ts
import { NotificationsGateway } from './notifications.gateway';

function makeConfigService(secret = 'test-secret') {
  return { get: jest.fn().mockReturnValue(secret) } as any;
}

function makeServer() {
  const rooms = new Map<string, Set<string>>();
  const to = jest.fn().mockReturnThis();
  const emit = jest.fn();
  return {
    to,
    emit,
    sockets: { adapter: { rooms } },
    __rooms: rooms,
  } as any;
}

describe('NotificationsGateway - presencia y listeners de chat', () => {
  let gateway: NotificationsGateway;
  let prisma: any;
  let server: ReturnType<typeof makeServer>;

  beforeEach(() => {
    prisma = {
      user: { update: jest.fn().mockResolvedValue({}) },
      chatConversationMember: {
        findUnique: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    gateway = new NotificationsGateway(makeConfigService(), prisma);
    server = makeServer();
    gateway.server = server;
  });

  describe('isUserOnline', () => {
    it('true si la room del usuario tiene al menos un socket', () => {
      server.__rooms.set('user:5', new Set(['socket-a']));
      expect(gateway.isUserOnline(5)).toBe(true);
    });

    it('false si la room no existe', () => {
      expect(gateway.isUserOnline(5)).toBe(false);
    });
  });

  describe('handleDisconnect', () => {
    it('escribe lastSeenAt y emite presenceChanged cuando era el último socket', async () => {
      const client: any = { id: 's1', data: { userId: 7 } };
      // La room ya no tiene al cliente (socket.io la saca antes de disparar 'disconnect').
      await gateway.handleDisconnect(client);

      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: { lastSeenAt: expect.any(Date) },
      });
      expect(server.emit).toHaveBeenCalledWith(
        'presenceChanged',
        expect.objectContaining({ userId: 7, online: false }),
      );
    });

    it('NO escribe lastSeenAt si el usuario todavía tiene otro socket vivo', async () => {
      server.__rooms.set('user:7', new Set(['otro-socket']));
      const client: any = { id: 's1', data: { userId: 7 } };

      await gateway.handleDisconnect(client);

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(server.emit).not.toHaveBeenCalled();
    });

    it('no hace nada si el cliente nunca completó el handshake (sin userId)', async () => {
      const client: any = { id: 's1', data: {} };
      await gateway.handleDisconnect(client);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });

  describe('handleChatDelivered', () => {
    it('actualiza deliveredAt y reemite a los demás miembros cuando el emisor es miembro', async () => {
      prisma.chatConversationMember.findUnique.mockResolvedValue({ id: 1 });
      prisma.chatConversationMember.findMany.mockResolvedValue([
        { userId: 20 },
        { userId: 21 },
      ]);
      const client: any = { data: { userId: 10 } };

      await gateway.handleChatDelivered(client, { conversationId: 3 });

      expect(prisma.chatConversationMember.updateMany).toHaveBeenCalledWith({
        where: { conversationId: 3, userId: 10 },
        data: { deliveredAt: expect.any(Date) },
      });
      expect(server.to).toHaveBeenCalledWith('user:20');
      expect(server.to).toHaveBeenCalledWith('user:21');
      expect(server.emit).toHaveBeenCalledWith(
        'chatDelivered',
        expect.objectContaining({ conversationId: 3, userId: 10 }),
      );
    });

    it('ignora el evento si el emisor NO es miembro de la conversación', async () => {
      prisma.chatConversationMember.findUnique.mockResolvedValue(null);
      const client: any = { data: { userId: 999 } };

      await gateway.handleChatDelivered(client, { conversationId: 3 });

      expect(prisma.chatConversationMember.updateMany).not.toHaveBeenCalled();
      expect(server.emit).not.toHaveBeenCalled();
    });
  });

  describe('handleChatTyping / handleChatStopTyping', () => {
    it('reemite chatTyping sólo a los demás miembros, validando membresía primero', async () => {
      prisma.chatConversationMember.findUnique.mockResolvedValue({ id: 1 });
      prisma.chatConversationMember.findMany.mockResolvedValue([{ userId: 20 }]);
      const client: any = { data: { userId: 10 } };

      await gateway.handleChatTyping(client, { conversationId: 3 });

      expect(server.to).toHaveBeenCalledWith('user:20');
      expect(server.emit).toHaveBeenCalledWith(
        'chatTyping',
        expect.objectContaining({ conversationId: 3, userId: 10 }),
      );
    });

    it('ignora chatStopTyping de alguien que no es miembro', async () => {
      prisma.chatConversationMember.findUnique.mockResolvedValue(null);
      const client: any = { data: { userId: 999 } };

      await gateway.handleChatStopTyping(client, { conversationId: 3 });

      expect(server.emit).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 9: Correr los tests**

Run: `cd /home/user/backend-emd && npm run test -- notifications.gateway.spec.ts`
Expected: todos pasan.

Run: `npm run test`
Expected: la suite completa pasa (incluye `chat.service.spec.ts` de la Task
2 y el resto de tests existentes — regresión).

- [ ] **Step 10: Build y lint**

Run: `npm run build`
Expected: sin errores de TypeScript.

Run: `npm run lint`
Expected: sin errores.

- [ ] **Step 11: Commit**

```bash
git add src/notifications/notifications.gateway.ts src/notifications/notifications.module.ts src/notifications/notifications.gateway.spec.ts
git commit -m "feat(chat): gateway escucha chatDelivered/chatTyping y notifica presencia"
```

## Verificación final del plan

- [ ] **Suite completa:** `npm run test` desde `/home/user/backend-emd`.
  Expected: PASS completo.
- [ ] **Build:** `npm run build`. Expected: sin errores.
- [ ] **Lint:** `npm run lint`. Expected: sin errores.
- [ ] **Schema:** `npx prisma validate && npx prisma generate`. Expected:
  ambos limpios.
