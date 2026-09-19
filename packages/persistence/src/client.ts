import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema";

/**
 * Concrete node-postgres database handle. The union `Database` below also
 * accepts a transaction handle so repository functions can be called with either
 * `db` or a `db.transaction((tx) => ...)` callback's `tx`.
 */
export type NodeDatabase = NodePgDatabase<typeof schema>;
export type DatabaseTransaction = Parameters<Parameters<NodeDatabase["transaction"]>[0]>[0];
export type Database = NodeDatabase | DatabaseTransaction;

export interface DbClient {
  readonly db: NodeDatabase;
  readonly pool: Pool;
  close(): Promise<void>;
}

/**
 * Builds a pooled Drizzle client for a caller-supplied connection string. The
 * pool uses the `pg` defaults (max 10 clients) — deliberately minimal; a
 * deployment that needs a different ceiling passes its own `Pool` to
 * `drizzle()`. Never reads `process.env`: the caller owns URL resolution.
 */
export function createDb(connectionString: string): DbClient {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
