import { validateEnv } from './env.validation';

const baseEnv = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
  JWT_SECRET: 'a'.repeat(32),
};

describe('validateEnv', () => {
  it('applies defaults for optional variables', () => {
    const env = validateEnv({ ...baseEnv });

    expect(env.JWT_ACCESS_EXPIRES_IN).toBe('1d');
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
});
