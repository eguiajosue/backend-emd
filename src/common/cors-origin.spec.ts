import { isOriginAllowed, parseAllowedOrigins } from './cors-origin';

describe('parseAllowedOrigins', () => {
  it('parses a comma separated list, ignoring blanks and spaces', () => {
    expect(
      parseAllowedOrigins(' https://a.com , https://b.com ,, '),
    ).toEqual(['https://a.com', 'https://b.com']);
  });
});

describe('isOriginAllowed', () => {
  const allowed = ['https://emd.com'];

  it('allows requests without Origin (curl, health checks, apps nativas)', () => {
    expect(isOriginAllowed(undefined, allowed)).toBe(true);
  });

  it('allows an exact match of FRONTEND_URL', () => {
    expect(isOriginAllowed('https://emd.com', allowed)).toBe(true);
  });

  it('allows the project preview URLs of Vercel', () => {
    // El hash de deploy y el scope cambian en cada push; exigir que
    // FRONTEND_URL se actualice a mano rompía CORS constantemente.
    expect(isOriginAllowed('https://frontend-emd.vercel.app', allowed)).toBe(
      true,
    );
    expect(
      isOriginAllowed(
        'https://frontend-emd-4dct7dcr7-josue-projects.vercel.app',
        allowed,
      ),
    ).toBe(true);
  });

  it('rejects other vercel projects', () => {
    // Si no, cualquier sitio alojado en Vercel podría llamar a la API con
    // credenciales.
    expect(isOriginAllowed('https://otro-proyecto.vercel.app', allowed)).toBe(
      false,
    );
    expect(
      isOriginAllowed('https://evil-frontend-emd.vercel.app', allowed),
    ).toBe(false);
  });

  it('rejects an unrelated origin', () => {
    expect(isOriginAllowed('https://evil.com', allowed)).toBe(false);
  });
});
