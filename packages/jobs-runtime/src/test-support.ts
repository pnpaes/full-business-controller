import type {
  JobWithMetadata,
  Queue,
  QueueResult,
  ScheduleOptions,
  SendOptions,
  UpdateQueueOptions,
  WorkHandler,
} from "pg-boss";

import type {
  BossMonitorApi,
  BossQueueApi,
  BossScheduleApi,
  BossSendApi,
  BossWorkApi,
} from "./boss";

/** A recorded `send` call. */
export interface SentJob {
  readonly name: string;
  readonly data: object | null | undefined;
  readonly options: SendOptions | undefined;
}

/** A recorded queue create/update call. */
export interface QueueCall {
  readonly name: string;
  readonly options: Omit<Queue, "name"> | UpdateQueueOptions | undefined;
}

export interface WorkCall {
  readonly name: string;
  readonly handler: unknown;
}

export interface ScheduleCall {
  readonly name: string;
  readonly cron: string;
  readonly data: object | null | undefined;
  readonly options: ScheduleOptions | undefined;
}

export type SendResult = (
  name: string,
  data: object | null | undefined,
  options: SendOptions | undefined,
) => string | null;

/**
 * In-memory pg-boss fake for the runtime unit suite (no database). It records the
 * calls the runtime makes and lets a test force a `send` result.
 */
export class FakeBoss
  implements BossQueueApi, BossSendApi, BossWorkApi, BossScheduleApi, BossMonitorApi
{
  readonly sent: SentJob[] = [];
  readonly createdQueues: QueueCall[] = [];
  readonly updatedQueues: QueueCall[] = [];
  readonly worked: WorkCall[] = [];
  readonly scheduled: ScheduleCall[] = [];
  /** The monitor's `getQueues`/`getQueue` source of truth (crafted by a test). */
  readonly queues: QueueResult[] = [];
  /** The monitor's `findJobs` source, keyed by queue name. */
  readonly queuedJobs: Record<string, JobWithMetadata[]> = {};
  sendResult: SendResult = () => "job-id";

  send(name: string, data?: object | null, options?: SendOptions): Promise<string | null> {
    this.sent.push({ name, data, options });
    return Promise.resolve(this.sendResult(name, data, options));
  }

  createQueue(name: string, options?: Omit<Queue, "name">): Promise<void> {
    this.createdQueues.push({ name, options });
    return Promise.resolve();
  }

  updateQueue(name: string, options: UpdateQueueOptions): Promise<void> {
    this.updatedQueues.push({ name, options });
    return Promise.resolve();
  }

  work<ReqData, ResData = unknown>(
    name: string,
    handler: WorkHandler<ReqData, ResData>,
  ): Promise<string> {
    this.worked.push({ name, handler });
    return Promise.resolve("fake-worker-id");
  }

  schedule(
    name: string,
    cron: string,
    data?: object | null,
    options?: ScheduleOptions,
  ): Promise<void> {
    this.scheduled.push({ name, cron, data, options });
    return Promise.resolve();
  }

  getQueues(names?: string[]): Promise<QueueResult[]> {
    const rows =
      names === undefined ? this.queues : this.queues.filter((queue) => names.includes(queue.name));
    return Promise.resolve([...rows]);
  }

  getQueue(name: string): Promise<QueueResult | null> {
    return Promise.resolve(this.queues.find((queue) => queue.name === name) ?? null);
  }

  findJobs<T = object>(name: string): Promise<JobWithMetadata<T>[]> {
    return Promise.resolve((this.queuedJobs[name] ?? []) as unknown as JobWithMetadata<T>[]);
  }
}
