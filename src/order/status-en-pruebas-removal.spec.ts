import * as fs from 'fs';
import * as path from 'path';

const PRISMA_DIR = path.join(__dirname, '..', '..', 'prisma');
const MIGRATION_SQL = path.join(
  PRISMA_DIR,
  'migrations',
  '20260906140000_remove_en_pruebas_status',
  'migration.sql',
);

describe('Eliminación del estado "en pruebas"', () => {
  const sql = fs.readFileSync(MIGRATION_SQL, 'utf8');
  const seed = fs.readFileSync(path.join(PRISMA_DIR, 'seed.ts'), 'utf8');

  it('la migración migra los pedidos a "en proceso" antes de borrar el estado', () => {
    const updateIdx = sql.indexOf('UPDATE "Order" SET "statusId"');
    const deleteIdx = sql.indexOf('DELETE FROM "Status"');
    expect(updateIdx).toBeGreaterThan(-1);
    expect(deleteIdx).toBeGreaterThan(updateIdx);
    expect(sql).toContain("lower(\"name\") = 'en proceso'");
  });

  it('la migración reapunta el historial (FKs a Status) para poder borrar la fila', () => {
    expect(sql).toContain('UPDATE "OrderHistory" SET "previousStatusId"');
    expect(sql).toContain('UPDATE "OrderHistory" SET "newStatusId"');
  });

  it('la migración es segura si el estado ya no existe o falta el destino', () => {
    expect(sql).toContain('IF old_status_id IS NULL THEN');
    expect(sql).toContain('IF target_status_id IS NULL THEN');
  });

  it('el seed ya no siembra "en pruebas"', () => {
    expect(seed.toLowerCase()).not.toContain("'en pruebas'");
  });

  it('el seed mantiene los ids históricos (entregado sigue siendo 5)', () => {
    expect(seed).toMatch(/\{\s*id:\s*5,\s*name:\s*'entregado'\s*\}/);
    expect(seed).toMatch(/\{\s*id:\s*3,\s*name:\s*'en proceso'\s*\}/);
    // La secuencia se reposiciona tras insertar ids explícitos.
    expect(seed).toContain('pg_get_serial_sequence');
  });
});
