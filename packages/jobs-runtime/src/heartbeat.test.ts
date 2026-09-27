import type { NodeDatabase } from "@aquarela/persistence";
import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  defaultWorkerHeartbeatId,
  startHeartbeat,
} from "./heartbeat";
import type { RuntimeLogger } from "./logging";

interface RecordedBeat {
  readonly values: Record<string, unknown>;
  readonly conflict: { readonly target: unknown; readonly set: Record<string, unknown> };
}

/**
 * A minimal fake of the single Drizzle write the heartbeat performs
 * (`insert(...).values(...).onConflictDoUpdate(...)`). The push happens when the
 * chain is assembled, so it records synchronously.
 */
function recordingDb(beats: RecordedBeat[]): NodeDatabase {
  return {
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        onConflictDoUpdate: (conflict: RecordedBeat["conflict"]) => {
          beats.push({ values, conflict });
          return Promise.resolve(undefined);
        },
      }),
    }),
  } as unknown as NodeDatabase;
}

function recordingLogger(): { logger: RuntimeLogger; error: ReturnType<typeof vi.fn> } {
  const error = vi.fn();
  const logger = { error, info: vi.fn(), warn: vi.fn() } as unknown as RuntimeLogger;
  return { logger, error };
}

describe("startHeartbeat", () => {
  it("writes one heartbeat immediately and then on each interval", () => {
    vi.useFakeTimers();
    try {
      const beats: RecordedBeat[] = [];
      const { logger } = recordingLogger();
      const timer = startHeartbeat({
        db: recordingDb(beats),
        role: "worker",
        workerId: "worker:test:1",
        intervalMs: 1000,
        logger,
      });

      expect(beats).toHaveLength(1);
      expect(beats[0]?.values).toMatchObject({ workerId: "worker:test:1", role: "worker" });
      expect(beats[0]?.conflict.set).toMatchObject({ role: "worker" });

      vi.advanceTimersByTime(2000);
      expect(beats).toHaveLength(3);

      clearInterval(timer);
    } finally {
      vi.useRealTimers();
    }
  });

  it("swallows a write failure, logs it and keeps beating", async () => {
    const { logger, error } = recordingLogger();
    const db = {
      insert: () => {
        throw new Error("boom");
      },
    } as unknown as NodeDatabase;

    const timer = startHeartbeat({
      db,
      role: "scheduler",
      workerId: "scheduler:test:2",
      intervalMs: 60_000,
      logger,
    });
    // Let the immediate (failing) beat settle before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));
    clearInterval(timer);

    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ workerId: "scheduler:test:2", role: "scheduler" }),
      "worker heartbeat write failed",
    );
  });
});

describe("defaultWorkerHeartbeatId", () => {
  it("derives the id from role, hostname and pid unless overridden", () => {
    const previous = process.env.WORKER_HEARTBEAT_ID;
    delete process.env.WORKER_HEARTBEAT_ID;
    try {
      expect(defaultWorkerHeartbeatId("scheduler")).toMatch(/^scheduler:.+:\d+$/);
      process.env.WORKER_HEARTBEAT_ID = "instance-42";
      expect(defaultWorkerHeartbeatId("worker")).toBe("instance-42");
    } finally {
      if (previous === undefined) {
        delete process.env.WORKER_HEARTBEAT_ID;
      } else {
        process.env.WORKER_HEARTBEAT_ID = previous;
      }
    }
  });

  it("defaults the beat interval to 30 seconds", () => {
    expect(DEFAULT_HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });
});
