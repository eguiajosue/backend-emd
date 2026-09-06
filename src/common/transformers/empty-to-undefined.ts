import { Transform } from 'class-transformer';

/**
 * El frontend manda strings vacíos para los campos opcionales que el usuario
 * no completó. Los normalizamos a `undefined` para que `@IsOptional()` +
 * validadores de formato (email, etc.) no fallen con "".
 */
export const EmptyToUndefined = () =>
  Transform(({ value }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  );

/** Trim de strings antes de validar. */
export const TrimString = () =>
  Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
