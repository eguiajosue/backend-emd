-- Preferencia personal de cada usuario para ver sus tareas de producción:
-- 'unified' (todas juntas, etiquetadas por área) o 'split' (separadas por
-- área). No la impone el admin. Ver WORKFLOW.md §4.
ALTER TABLE "User" ADD COLUMN "areaViewMode" TEXT;
