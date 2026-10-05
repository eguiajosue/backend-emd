/**
 * Autor de un mockup, plantilla o logo tal como lo muestra el frontend: sólo
 * los campos necesarios para su nombre, sin password ni roles.
 */
export const MOCKUP_AUTHOR_SELECT = {
  select: { id: true, firstName: true, lastName: true, username: true },
} as const;

export interface MockupAuthorRow {
  id: number;
  firstName: string;
  lastName: string | null;
  username: string;
}

/**
 * `{ id, name }` del autor, o `null` si el usuario se borró. Mismo criterio
 * que `OrderService.userDisplayName`: nombre y apellido, o el username si no
 * tiene nombre cargado.
 */
export function mockupAuthor(
  row: MockupAuthorRow | null,
): { id: number; name: string } | null {
  if (!row) return null;
  return {
    id: row.id,
    name:
      [row.firstName, row.lastName].filter(Boolean).join(' ') || row.username,
  };
}
