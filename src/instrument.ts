// Sentry tiene que inicializarse ANTES de que se cargue cualquier otro módulo
// (Nest, Express, http) para poder instrumentarlos: por eso este archivo es
// el PRIMER import de main.ts. Sin SENTRY_DSN no hace nada.
// Ver docs/monitoring.md.
import * as Sentry from '@sentry/nestjs';
import { buildSentryOptions } from './common/sentry/sentry-options';

const options = buildSentryOptions(process.env);
if (options) {
  Sentry.init(options);
}
