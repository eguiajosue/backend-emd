import { Test } from '@nestjs/testing';

// Las env vars deben existir ANTES de importar AppModule: ConfigModule.forRoot
// valida el entorno en tiempo de importación del módulo.
process.env.DATABASE_URL = 'postgresql://user:pass@localhost:5432/db';
process.env.JWT_SECRET = 'x'.repeat(40);

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { AppModule } = require('./app.module');

/**
 * Smoke test de wiring: compila el grafo de dependencias completo (sin
 * conectar a la base: `compile()` no dispara onModuleInit). Detecta providers
 * mal inyectados antes de llegar a producción.
 */
describe('AppModule', () => {
  it('compiles the dependency graph', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    expect(moduleRef).toBeDefined();
    await moduleRef.close();
  });
});
