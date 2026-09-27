import { createHash } from "node:crypto";

import type { CompetitorStore } from "@aquarela/application";
import type { NodeDatabase } from "@aquarela/persistence";
import { describe, expect, it, vi } from "vitest";

import { FakeCompetitorStore } from "../../application/src/competitors/test-support";
import {
  createCompetitorCollectorRun,
  extractFactsFromHtml,
  isPathAllowed,
  normalizePriceValue,
  parseRobotsTxt,
  registerCompetitorCollection,
  robotsAgentToken,
  runCompetitorCollection,
  type CollectOutcome,
  type CompetitorCollectorRun,
} from "./competitor-collector";
import { COMPETITOR_COLLECTION_QUEUE } from "./queues";
import { FakeBoss } from "./test-support";

const ORG = "org-1";
const PAGE = "https://rival.example/menu/latte";
const ROBOTS = "https://rival.example/robots.txt";

function pageResponse(
  body: string,
  status = 200,
  url = "",
  retryAfter: string | null = null,
): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: {
      get: (name: string) => (name.toLowerCase() === "retry-after" ? retryAfter : null),
    },
    text: async () => body,
  } as unknown as Response;
}

/**
 * A per-URL response queue: each fetch pops the next scripted response for its
 * URL, so retries and multi-source runs are deterministic and no network happens.
 */
function makeFetch(): {
  fetchImpl: typeof fetch;
  calls: string[];
  enqueue: (url: string, ...responses: Array<Response | Error>) => void;
} {
  const calls: string[] = [];
  const queues = new Map<string, Array<Response | Error>>();
  const fetchImpl = (async (input: string | URL | Request) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    const next = queues.get(url)?.shift();
    if (next === undefined) {
      throw new Error(`unexpected fetch: ${url}`);
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  }) as unknown as typeof fetch;
  return {
    fetchImpl,
    calls,
    enqueue: (url, ...responses) => {
      const existing = queues.get(url);
      if (existing === undefined) {
        queues.set(url, [...responses]);
      } else {
        existing.push(...responses);
      }
    },
  };
}

function fakeClock(): {
  now: () => number;
  sleep: (ms: number) => Promise<void>;
  sleeps: number[];
} {
  let clock = 0;
  const sleeps: number[] = [];
  return {
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    sleeps,
  };
}

function makeRun(overrides: Partial<Parameters<typeof createCompetitorCollectorRun>[0]> = {}): {
  run: CompetitorCollectorRun;
  fetch: ReturnType<typeof makeFetch>;
  clock: ReturnType<typeof fakeClock>;
} {
  const clock = fakeClock();
  const fetch = makeFetch();
  const run = createCompetitorCollectorRun({
    userAgent: "AquarelaBusinessControl/1.0",
    fetchImpl: fetch.fetchImpl,
    minDelayMs: 1000,
    timeoutMs: 1000,
    maxRetries: 2,
    retryBaseDelayMs: 1000,
    sleep: clock.sleep,
    now: clock.now,
    ...overrides,
  });
  return { run, fetch, clock };
}

function recordingLogger(): { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> } {
  return { info: vi.fn(), warn: vi.fn() };
}

class FakeCollector implements CompetitorCollectorRun {
  readonly calls: string[] = [];
  constructor(private readonly outcome: (url: string) => CollectOutcome) {}
  get pagesFetched(): number {
    return this.calls.length;
  }
  collect(url: string): Promise<CollectOutcome> {
    this.calls.push(url);
    return Promise.resolve(this.outcome(url));
  }
}

const ALLOWED_ROBOTS = "User-agent: *\nDisallow: /admin/";
const DISALLOW_ROBOTS = "User-agent: *\nDisallow: /menu/";

describe("robots.txt", () => {
  it("honours Disallow/Allow with longest-match precedence", () => {
    const groups = parseRobotsTxt("User-agent: *\nDisallow: /private/\nAllow: /private/public/");
    expect(groups).toBeDefined();
    const token = robotsAgentToken("AquarelaBusinessControl/1.0");
    expect(token).toBe("aquarelabusinesscontrol");
    expect(isPathAllowed(groups!, token, "/private/secret")).toBe(false);
    expect(isPathAllowed(groups!, token, "/private/public/ok")).toBe(true);
    expect(isPathAllowed(groups!, token, "/menu")).toBe(true);
  });

  it("fails closed (undefined) on an unparseable body", () => {
    expect(parseRobotsTxt("this is not a robots file")).toBeUndefined();
    expect(parseRobotsTxt("ok\u0000binary")).toBeUndefined();
  });

  it("prefers a matching agent group over the wildcard", () => {
    const groups = parseRobotsTxt(
      "User-agent: *\nDisallow: /\nUser-agent: AquarelaBusinessControl\nDisallow: /only-me/",
    )!;
    expect(isPathAllowed(groups, "aquarelabusinesscontrol", "/menu")).toBe(true);
    expect(isPathAllowed(groups, "aquarelabusinesscontrol", "/only-me/")).toBe(false);
  });

  it("normalises prices tolerantly", () => {
    expect(normalizePriceValue("4,50")).toBe("4.50");
    expect(normalizePriceValue("1 234,50")).toBe("1234.50");
    expect(normalizePriceValue("1,234.56")).toBe("1234.56");
    expect(normalizePriceValue(12)).toBe("12");
    expect(normalizePriceValue("kr 89,-")).toBe("89");
    expect(normalizePriceValue("free")).toBeNull();
    expect(normalizePriceValue(-1)).toBeNull();
  });
});

describe("extractFactsFromHtml", () => {
  it("extracts JSON-LD products with price, currency and category", () => {
    const html = [
      "<html><head>",
      '<script type="application/ld+json">',
      JSON.stringify({
        "@type": "Product",
        name: "Latte",
        category: "Coffee",
        offers: { "@type": "Offer", price: "4,50", priceCurrency: "NOK" },
      }),
      "</script></head><body></body></html>",
    ].join("");
    expect(extractFactsFromHtml(html)).toEqual([
      {
        externalName: "Latte",
        price: "4.50",
        currency: "NOK",
        productCategory: "Coffee",
        season: null,
      },
    ]);
  });

  it("falls back to meta tags when there is no JSON-LD", () => {
    const html = [
      "<html><head>",
      '<meta property="og:title" content="Cardamom bun">',
      '<meta property="product:price:amount" content="39">',
      '<meta property="product:price:currency" content="NOK">',
      "</head></html>",
    ].join("");
    expect(extractFactsFromHtml(html)).toEqual([
      {
        externalName: "Cardamom bun",
        price: "39",
        currency: "NOK",
        productCategory: null,
        season: null,
      },
    ]);
  });

  it("skips malformed JSON-LD and facts without a name", () => {
    const html =
      '<script type="application/ld+json">{not json</script>' +
      '<script type="application/ld+json">{"@type":"Product","price":"5"}</script>';
    expect(extractFactsFromHtml(html)).toEqual([]);
  });
});

describe("createCompetitorCollectorRun", () => {
  it("skips a robots-disallowed source without fetching the page", async () => {
    const { run, fetch } = makeRun();
    fetch.enqueue(ROBOTS, pageResponse(DISALLOW_ROBOTS));
    fetch.enqueue(PAGE, pageResponse("<html>ignored</html>"));

    expect(await run.collect(PAGE)).toEqual({ status: "skipped", reason: "robots-disallow" });
    expect(fetch.calls).toEqual([ROBOTS]);
  });

  it("fails closed when robots.txt is unparseable", async () => {
    const { run, fetch } = makeRun();
    fetch.enqueue(ROBOTS, pageResponse("not a robots file"));

    expect(await run.collect(PAGE)).toEqual({ status: "skipped", reason: "robots-unparseable" });
    expect(fetch.calls).toEqual([ROBOTS]);
  });

  it("fails closed when robots.txt cannot be fetched", async () => {
    const { run, fetch } = makeRun();
    fetch.enqueue(ROBOTS, pageResponse("nope", 500));

    expect(await run.collect(PAGE)).toEqual({ status: "skipped", reason: "robots-unavailable" });
    expect(fetch.calls).toEqual([ROBOTS]);
  });

  it("enforces at least one request per second per host", async () => {
    const { run, fetch, clock } = makeRun();
    const second = "https://rival.example/menu/flat-white";
    fetch.enqueue(ROBOTS, pageResponse(ALLOWED_ROBOTS));
    fetch.enqueue(PAGE, pageResponse("<html>a</html>"));
    fetch.enqueue(second, pageResponse("<html>b</html>"));

    await run.collect(PAGE);
    await run.collect(second);

    // The robots fetch is one request; each subsequent same-host request waits.
    expect(clock.sleeps).toEqual([1000, 1000]);
  });

  it("backs off on a 429 and then succeeds", async () => {
    const { run, fetch, clock } = makeRun();
    fetch.enqueue(ROBOTS, pageResponse(ALLOWED_ROBOTS));
    fetch.enqueue(PAGE, pageResponse("busy", 429), pageResponse("<html>ok</html>"));

    const outcome = await run.collect(PAGE);
    expect(outcome.status).toBe("collected");
    // sleep(1000) for the per-host delay, sleep(1000) for the 429 backoff.
    expect(clock.sleeps).toEqual([1000, 1000]);
  });

  it("bounds the page budget per run", async () => {
    const { run, fetch } = makeRun({ maxPagesPerRun: 1 });
    const second = "https://rival.example/menu/mocha";
    fetch.enqueue(ROBOTS, pageResponse(ALLOWED_ROBOTS));
    fetch.enqueue(PAGE, pageResponse("<html>a</html>"));

    expect((await run.collect(PAGE)).status).toBe("collected");
    expect(await run.collect(second)).toEqual({ status: "skipped", reason: "budget-exhausted" });
    expect(run.pagesFetched).toBe(1);
    expect(fetch.calls).not.toContain(second);
  });

  it("hashes the body and retains no raw HTML", async () => {
    const { run, fetch } = makeRun();
    const body =
      '<html><script type="application/ld+json">{"@type":"Product","name":"Latte","offers":{"price":"4.50","priceCurrency":"NOK"}}</script></html>';
    fetch.enqueue(ROBOTS, pageResponse(ALLOWED_ROBOTS));
    fetch.enqueue(PAGE, pageResponse(body));

    const outcome = await run.collect(PAGE);
    expect(outcome.status).toBe("collected");
    if (outcome.status !== "collected") throw new Error("expected collected");
    expect(outcome.contentHash).toBe(createHash("sha256").update(body).digest("hex"));
    expect(outcome.method).toBe("automated");
    expect(outcome.facts).toHaveLength(1);
    expect("html" in outcome || "body" in outcome).toBe(false);
  });

  it("never logs page content", async () => {
    const logger = recordingLogger();
    const { run, fetch } = makeRun({ logger });
    fetch.enqueue(ROBOTS, pageResponse(ALLOWED_ROBOTS));
    fetch.enqueue(PAGE, pageResponse("<html>SECRET-PAGE-CONTENT</html>"));

    await run.collect(PAGE);

    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.warn.mock.calls]);
    expect(logged).not.toContain("SECRET-PAGE-CONTENT");
  });
});

function seedStore(): { store: FakeCompetitorStore; sourceUrl: string; competitorId: string } {
  const store = new FakeCompetitorStore();
  const competitor = store.seedCompetitor({ organizationId: ORG, name: "Rival" });
  const sourceUrl = "https://rival.example/menu";
  store.seedCompetitorSource({
    organizationId: ORG,
    competitorName: "Rival",
    competitorId: competitor.id,
    sourceType: "website",
    urlOrIdentifier: sourceUrl,
    collectionMode: "automated",
    termsStatus: "approved",
    approvedBy: "owner-1",
    approvedAt: "2026-09-01T00:00:00.000Z",
  });
  return { store, sourceUrl, competitorId: competitor.id };
}

function collectedOutcome(url: string): CollectOutcome {
  return {
    status: "collected",
    url,
    capturedAt: "2026-09-27T07:00:00.000Z",
    method: "automated",
    contentHash: "abc123",
    facts: [
      {
        externalName: "Latte",
        price: "4.5000",
        currency: "NOK",
        productCategory: "Coffee",
        season: null,
      },
    ],
  };
}

describe("runCompetitorCollection", () => {
  it("skips without reading or fetching when the kill switch is off", async () => {
    const collectorRun = new FakeCollector(() => collectedOutcome(PAGE));
    const store = {
      listCompetitorSources: () => Promise.reject(new Error("must not read")),
    } as unknown as CompetitorStore;

    const outcome = await runCompetitorCollection({
      organizationId: ORG,
      enabled: false,
      store,
      collector: collectorRun,
    });

    expect(outcome).toEqual({ status: "skipped", reason: "disabled" });
    expect(collectorRun.calls).toEqual([]);
  });

  it("skips without fetching when there is no approved automated source", async () => {
    const store = new FakeCompetitorStore();
    store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "Manual",
      urlOrIdentifier: "https://manual.example/menu",
      collectionMode: "manual",
      termsStatus: "approved",
    });
    store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "Unapproved",
      urlOrIdentifier: "https://pending.example/menu",
      collectionMode: "automated",
      termsStatus: "pending",
    });
    const collectorRun = new FakeCollector(() => collectedOutcome(PAGE));

    const outcome = await runCompetitorCollection({
      organizationId: ORG,
      enabled: true,
      store,
      collector: collectorRun,
    });

    expect(outcome).toEqual({ status: "skipped", reason: "no-sources" });
    expect(collectorRun.calls).toEqual([]);
  });

  it("never fetches a manual or unapproved source but collects an approved automated one", async () => {
    const store = new FakeCompetitorStore();
    const competitor = store.seedCompetitor({ organizationId: ORG, name: "Rival" });
    store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "Manual",
      urlOrIdentifier: "https://manual.example/menu",
      collectionMode: "manual",
      termsStatus: "approved",
    });
    store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "Unapproved",
      urlOrIdentifier: "https://pending.example/menu",
      collectionMode: "automated",
      termsStatus: "pending",
    });
    store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "Rival",
      competitorId: competitor.id,
      urlOrIdentifier: "https://rival.example/menu",
      collectionMode: "automated",
      termsStatus: "approved",
      approvedBy: "owner-1",
      approvedAt: "2026-09-01T00:00:00.000Z",
    });
    const collectorRun = new FakeCollector((url) => collectedOutcome(url));

    const outcome = await runCompetitorCollection({
      organizationId: ORG,
      enabled: true,
      store,
      collector: collectorRun,
    });

    expect(collectorRun.calls).toEqual(["https://rival.example/menu"]);
    expect(outcome).toMatchObject({ status: "completed", sources: 1, collected: 1 });
  });

  it("records pending observations with mandatory provenance", async () => {
    const { store, competitorId } = seedStore();
    const collectorRun = new FakeCollector((url) => collectedOutcome(url));

    const outcome = await runCompetitorCollection({
      organizationId: ORG,
      enabled: true,
      store,
      collector: collectorRun,
    });

    expect(outcome).toMatchObject({ status: "completed", collected: 1, observations: 1 });
    const observations = [...store.observations.values()];
    expect(observations).toHaveLength(1);
    const observation = observations[0]!;
    expect(observation).toMatchObject({
      organizationId: ORG,
      competitorId,
      reviewStatus: "pending",
      captureMethod: "automated",
      sourceUrl: "https://rival.example/menu",
      externalName: "Latte",
      price: "4.5000",
      currency: "NOK",
      productCategory: "Coffee",
    });
    expect(observation.competitorSourceId).not.toBeNull();
    expect(observation.provenance).toEqual({
      url: "https://rival.example/menu",
      capturedAt: "2026-09-27T07:00:00.000Z",
      method: "automated",
      contentHash: "abc123",
    });
    expect(store.audits).toHaveLength(1);
  });

  it("logs a fetch failure and never throws", async () => {
    const { store } = seedStore();
    const logger = recordingLogger();
    const collectorRun = new FakeCollector(() => ({
      status: "failed",
      reason: "http-error",
      httpStatus: 503,
    }));

    const outcome = await runCompetitorCollection({
      organizationId: ORG,
      enabled: true,
      store,
      collector: collectorRun,
      logger,
    });

    expect(outcome).toMatchObject({ status: "completed", failed: 1, observations: 0 });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(store.observations.size).toBe(0);
  });

  it("thrown collection is logged and does not abort the run", async () => {
    const { store } = seedStore();
    const logger = recordingLogger();
    const collectorRun = new FakeCollector(() => {
      throw new Error("boom");
    });

    const outcome = await runCompetitorCollection({
      organizationId: ORG,
      enabled: true,
      store,
      collector: collectorRun,
      logger,
    });

    expect(outcome).toMatchObject({ status: "completed", failed: 1 });
    expect(logger.warn).toHaveBeenCalledTimes(1);
  });

  it("skips an automated source that has no competitor link (no id is guessed)", async () => {
    const store = new FakeCompetitorStore();
    store.seedCompetitorSource({
      organizationId: ORG,
      competitorName: "Unlinked",
      competitorId: null,
      urlOrIdentifier: "https://unlinked.example/menu",
      collectionMode: "automated",
      termsStatus: "approved",
      approvedBy: "owner-1",
      approvedAt: "2026-09-01T00:00:00.000Z",
    });
    const collectorRun = new FakeCollector((url) => collectedOutcome(url));

    const outcome = await runCompetitorCollection({
      organizationId: ORG,
      enabled: true,
      store,
      collector: collectorRun,
    });

    expect(collectorRun.calls).toEqual([]);
    expect(outcome).toMatchObject({ status: "completed", skipped: 1, observations: 0 });
  });
});

describe("registerCompetitorCollection", () => {
  function fakeDb(): NodeDatabase {
    return {} as unknown as NodeDatabase;
  }

  it("registers the cron queue and schedule with missed:once", async () => {
    const boss = new FakeBoss();
    await registerCompetitorCollection(boss, fakeDb(), {
      organizationId: ORG,
      cron: "0 7 * * 1",
      enabled: false,
      store: new FakeCompetitorStore(),
    });

    expect(boss.worked[0]!.name).toBe(COMPETITOR_COLLECTION_QUEUE);
    expect(boss.scheduled[0]).toMatchObject({
      name: COMPETITOR_COLLECTION_QUEUE,
      cron: "0 7 * * 1",
      options: { missed: "once" },
    });
  });

  it("makes no network request through the handler when disabled", async () => {
    const boss = new FakeBoss();
    const fetchImpl = vi.fn();
    await registerCompetitorCollection(boss, fakeDb(), {
      organizationId: ORG,
      cron: "0 7 * * 1",
      enabled: false,
      store: new FakeCompetitorStore(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const handler = boss.worked[0]!.handler as (jobs: unknown[]) => Promise<void>;
    await handler([{ id: "job-1", data: { organizationId: ORG } }]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
