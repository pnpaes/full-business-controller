import { PgBoss } from "pg-boss";
import type {
  ConstructorOptions,
  FindJobsOptions,
  JobWithMetadata,
  Queue,
  QueueResult,
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

/**
 * The read-only pg-boss monitoring surface (12.33.2): queue counters
 * (`getQueues`/`getQueue`) and job rows (`findJobs`). `FindJobsOptions` has no
 * order/limit, so a caller bounded by queue depth must scan and compute the
 * aggregate itself (see the monitor).
 */
export interface BossMonitorApi {
  getQueues(names?: string[]): Promise<readonly QueueResult[]>;
  getQueue(name: string): Promise<QueueResult | null>;
  findJobs<T = object>(
    name: string,
    options?: FindJobsOptions,
  ): Promise<readonly JobWithMetadata<T>[]>;
}

export type JobsBoss = BossSendApi & BossWorkApi & BossScheduleApi & BossQueueApi & BossMonitorApi;

/** The handle a started worker/scheduler returns; `stop` is idempotent. */
export interface JobsRuntimeHandle {
  readonly boss: PgBoss;
  stop(): Promise<void>;
}
