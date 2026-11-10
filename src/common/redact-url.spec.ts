import { redactSecretsInUrl } from './redact-url';

describe('redactSecretsInUrl', () => {
  it('oculta el token del portal y conserva el resto de la ruta', () => {
    expect(redactSecretsInUrl('/portal/AbC_123-xyz/design-files/4')).toBe(
      '/portal/[token]/design-files/4',
    );
    expect(redactSecretsInUrl('/portal/AbC_123-xyz')).toBe('/portal/[token]');
    expect(redactSecretsInUrl('/portal/AbC_123-xyz/push?x=1')).toBe(
      '/portal/[token]/push?x=1',
    );
  });

  it('también en URLs absolutas (Sentry)', () => {
    expect(
      redactSecretsInUrl('https://api.emd.mx/portal/AbC_123-xyz/respond'),
    ).toBe('https://api.emd.mx/portal/[token]/respond');
  });

  it('no toca otras rutas', () => {
    expect(redactSecretsInUrl('/orders/12/share-link')).toBe(
      '/orders/12/share-link',
    );
    expect(redactSecretsInUrl('/health')).toBe('/health');
  });
});
