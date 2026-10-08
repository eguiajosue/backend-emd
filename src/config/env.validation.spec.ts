import { validateEnv } from './env.validation';

const baseEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults for optional variables', () => {
    const env = validateEnv({ ...baseEnv });

    expect(env.JWT_ACCESS_EXPIRES_IN).toBe('15m');
    expect(env.TRUST_PROXY_HOPS).toBe(1);
    expect(env.JWT_REFRESH_EXPIRES_IN).toBe('7d');
    expect(env.BACKEND_PORT).toBe(3001);
    expect(env.FRONTEND_URL).toBe('http://localhost:3000');
    expect(env.REDIS_URL).toBeUndefined();
  });

  it('fails fast when DATABASE_URL is missing', () => {
    expect(() => validateEnv({ JWT_SECRET: 'a'.repeat(32) })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('fails fast when JWT_SECRET is missing or too short', () => {
    expect(() => validateEnv({ DATABASE_URL: baseEnv.DATABASE_URL })).toThrow(
      /JWT_SECRET/,
    );
    expect(() => validateEnv({ ...baseEnv, JWT_SECRET: 'short' })).toThrow(
      /al menos 32 caracteres/,
    );
  });

  it('coerces numeric variables', () => {
    const env = validateEnv({ ...baseEnv, PORT: '8080' });
    expect(env.PORT).toBe(8080);
  });

  describe('producción', () => {
    const prodEnv = { ...baseEnv, NODE_ENV: 'production' };

    it('exige JWT_REFRESH_SECRET', () => {
      expect(() => validateEnv(prodEnv)).toThrow(/JWT_REFRESH_SECRET/);
    });

    it('rechaza JWT_REFRESH_SECRET igual a JWT_SECRET', () => {
      expect(() =>
        validateEnv({ ...prodEnv, JWT_REFRESH_SECRET: baseEnv.JWT_SECRET }),
      ).toThrow(/distinto de JWT_SECRET/);
    });

    it('valida con un JWT_REFRESH_SECRET propio', () => {
      expect(() =>
        validateEnv({ ...prodEnv, JWT_REFRESH_SECRET: 'b'.repeat(32) }),
      ).not.toThrow();
    });
  });

  describe('almacenamiento y Sentry', () => {
    it('sin variables: driver db, región auto y Sentry apagado', () => {
      const env = validateEnv({ ...baseEnv });
      expect(env.STORAGE_DRIVER).toBe('db');
      expect(env.S3_REGION).toBe('auto');
      expect(env.SENTRY_DSN).toBeUndefined();
      expect(env.SENTRY_TRACES_SAMPLE_RATE).toBe(0);
    });

    it('los strings vacíos de .env.example cuentan como no definidos', () => {
      const env = validateEnv({
        ...baseEnv,
        STORAGE_DRIVER: '',
        S3_BUCKET: '',
        SENTRY_DSN: '',
        SENTRY_TRACES_SAMPLE_RATE: '',
      });
      expect(env.STORAGE_DRIVER).toBe('db');
      expect(env.S3_BUCKET).toBeUndefined();
      expect(env.SENTRY_DSN).toBeUndefined();
    });

    it('STORAGE_DRIVER=s3 exige todas las S3_*', () => {
      expect(() =>
        validateEnv({
          ...baseEnv,
          STORAGE_DRIVER: 's3',
          S3_ENDPOINT: 'https://x.r2.cloudflarestorage.com',
        }),
      ).toThrow(/S3_BUCKET es obligatoria con STORAGE_DRIVER=s3/);
    });

    it('STORAGE_DRIVER=s3 completo valida', () => {
      const env = validateEnv({
        ...baseEnv,
        STORAGE_DRIVER: 's3',
        S3_ENDPOINT: 'https://x.r2.cloudflarestorage.com',
        S3_BUCKET: 'emd',
        S3_ACCESS_KEY_ID: 'id',
        S3_SECRET_ACCESS_KEY: 'secret',
      });
      expect(env.STORAGE_DRIVER).toBe('s3');
    });

    it('rechaza un driver desconocido y un sample rate fuera de rango', () => {
      expect(() => validateEnv({ ...baseEnv, STORAGE_DRIVER: 'gcs' })).toThrow(
        /STORAGE_DRIVER/,
      );
      expect(() =>
        validateEnv({ ...baseEnv, SENTRY_TRACES_SAMPLE_RATE: '1.5' }),
      ).toThrow(/SENTRY_TRACES_SAMPLE_RATE/);
    });
  });
});
