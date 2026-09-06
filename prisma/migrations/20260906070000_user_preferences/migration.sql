-- Preferencias de usuario (tema, color de acento, idioma) persistidas por cuenta
-- en vez de en localStorage del navegador.
ALTER TABLE "User" ADD COLUMN "themePreference" TEXT;
ALTER TABLE "User" ADD COLUMN "accentColor" TEXT;
ALTER TABLE "User" ADD COLUMN "languagePreference" TEXT;
