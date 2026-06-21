import { buildApp } from './app.js';
import { loadConfig } from './platform/config.js';

/** Production/dev entrypoint. `pnpm dev` runs `tsx watch src/server.ts`. */
async function main() {
  const config = loadConfig();
  const app = await buildApp({ config });

  // Safety net: a stray rejection/exception (e.g. a background job promise no
  // one awaits) must not silently kill the API. unhandledRejection is logged
  // and survived; uncaughtException leaves the process in an undefined state,
  // so we log and exit (let tsx watch / the orchestrator restart us).
  process.on('unhandledRejection', (reason) => {
    app.log.error({ err: reason }, 'unhandledRejection (non-fatal)');
  });
  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'uncaughtException — exiting');
    process.exit(1);
  });

  // Graceful shutdown: on SIGTERM/SIGINT close the server, which runs the
  // onClose hooks (drains in-flight requests/SSE, closes the postgres pool).
  // Guarded so a second signal during shutdown doesn't double-close.
  let closing = false;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, async () => {
      if (closing) return;
      closing = true;
      app.log.info(`${signal} received — shutting down`);
      try {
        await app.close();
        process.exit(0);
      } catch (err) {
        app.log.error(err, 'error during shutdown');
        process.exit(1);
      }
    });
  }

  try {
    await app.listen({ port: config.apiPort, host: '0.0.0.0' });
    app.log.info(`DevDigest API listening on http://localhost:${config.apiPort}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
