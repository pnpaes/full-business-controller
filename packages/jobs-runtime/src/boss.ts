import { PgBoss } from "pg-boss";
import type {
  ConstructorOptions,
  Queue,
  ScheduleOptions,
  SendOptions,
  UpdateQueueOptions,
  WorkHandler,
} from "pg-boss";

/**
 * `ADR-0004` shape P2 runtime: pg-boss is the disposable runner over the durable
 * `outbox_event` table. The `pgboss` schema is owned by the pre-deploy migrator
 * (`DEC-139`), so the runtime starts with `migrate: false` and `createSchema:
 * false` — `start()` then runs the contractor's schema check instead of DDL. Queue
 * rows are runtime DML (`createQueue`/`updateQueue`), not schema DDL.
 *
 * LISTEN/NOTIFY is off: our deployment runs behind a pooler that cannot carry a
 * session-pinned listener, and polling is the correctness floor anyway.
 */
export type BossOptions = Partial<ConstructorOptions>;

export function createBoss(connectionString: string, opts: BossOptions = {}): PgBoss {
  return new PgBoss({
    connectionString,
    schema: "pgboss",
    migrate: false,
    createSchema: false,
    useListenNotify: false,
    ...opts,
  });
}

/**
 * The minimal structural slice of {@link PgBoss} each runtime seam needs. A real
 * `PgBoss` satisfies all of them; the unit suite fakes them without a database.
 */
export interface BossSendApi {
  send(name: string, data?: object | null, options?: SendOptions): Promise<string | null>;
}

export interface BossWorkApi {
  work<ReqData, ResData = unknown>(
    name: string,
    handler: WorkHandler<ReqData, ResData>,
  ): Promise<string>;
}

export interface BossScheduleApi {
  schedule(
    name: string,
    cron: string,
    data?: object | null,
    options?: ScheduleOptions,
  ): Promise<void>;
}

export interface BossQueueApi {
  createQueue(name: string, options?: Omit<Queue, "name">): Promise<void>;
  updateQueue(name: string, options: UpdateQueueOptions): Promise<void>;
}

export type JobsBoss = BossSendApi & BossWorkApi & BossScheduleApi & BossQueueApi;

/** The handle a started worker/scheduler returns; `stop` is idempotent. */
export interface JobsRuntimeHandle {
  readonly boss: PgBoss;
  stop(): Promise<void>;
}
