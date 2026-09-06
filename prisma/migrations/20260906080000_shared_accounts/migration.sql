-- Cuentas compartidas de área (ej. "Taller"): un User normal con este flag
-- activado, usado por varias personas con el mismo login.
ALTER TABLE "User" ADD COLUMN "isSharedAccount" BOOLEAN NOT NULL DEFAULT false;
