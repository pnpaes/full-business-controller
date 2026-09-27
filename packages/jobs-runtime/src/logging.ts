import type { createLogger } from "@aquarela/logger";

/** The structured logger the runtime entrypoints accept (pino, redaction on). */
export type RuntimeLogger = ReturnType<typeof createLogger>;
