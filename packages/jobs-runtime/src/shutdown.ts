import type { RuntimeLogger } from "./logging";

/**
 * Graceful shutdown for the long-lived worker and scheduler processes: stop
 * pg-boss (drain in-flight work) and close the pool, then exit 0. The handle's
 * `stop` is idempotent, so a signal racing a smoke exit is safe.
 */
export function installShutdownHandlers(stop: () => Promise<void>, logger: RuntimeLogger): void {
  const shutdown = (signal: NodeJS.Signals): void => {
    logger.info({ signal }, "shutting down");
    void stop()
      .catch((error: unknown) => logger.error({ err: error }, "shutdown failed"))
      .finally(() => process.exit(0));
  };

  process.once("SIGTERM", () => shutdown("SIGTERM"));
  process.once("SIGINT", () => shutdown("SIGINT"));
}
