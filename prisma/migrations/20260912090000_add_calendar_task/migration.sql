-- Lista de tareas pendientes del calendario de equipo: actividades sin
-- fecha todavía definida, separadas de "CalendarEvent" (que sí tiene
-- fecha/hora). Mismo equipo/visibilidad que el calendario, sin asignación
-- a una persona en particular.

-- CreateTable
CREATE TABLE "CalendarTask" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "completed" BOOLEAN NOT NULL DEFAULT false,
    "completedAt" TIMESTAMP(3),
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CalendarTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CalendarTask_completed_idx" ON "CalendarTask"("completed");

-- CreateIndex
CREATE INDEX "CalendarTask_createdById_idx" ON "CalendarTask"("createdById");

-- AddForeignKey
ALTER TABLE "CalendarTask" ADD CONSTRAINT "CalendarTask_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
