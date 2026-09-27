import { createHash } from "node:crypto";

import {
  createPostgresCompetitorStore,
  listCompetitorSources,
  recordCompetitorObservation,
} from "@aquarela/application";
import type { CompetitorSourceRecord, CompetitorStore } from "@aquarela/application";
import type { NodeDatabase } from "@aquarela/persistence";

import type { JobsBoss } from "./boss";
import type { RuntimeLogger } from "./logging";
import { COMPETITOR_COLLECTION_QUEUE } from "./queues";

/**
 * `ADR-0010` (accepted 2026-09-27) / `DEC-143` (`DEC-149`, row 18b): the
 * scheduled competitor collector.
 *
 * **Approved sources only.** The cron reads the organization's
 * `competitor_source` register and collects only sources that are active **and**
 * `collection_mode = 'automated'` **and** `terms_status = 'approved'` (the
 * `DEC-149` policy; the table check is the structural backstop). A manual source
 * is never fetched.
 *
 * **Polite and fail-closed.** It fetches and honours `/robots.txt` for the
 * configured user-agent and skips a source when robots cannot be fetched or is
 * unparseable; it makes at most one request per `COMMIT_MIN_DELAY_MS` per host
 * (default 1000 ms, i.e. ≤ 1 req/s); it bounds each run's page fetches; and it
 * backs off (bounded retries) on `429`/`5xx`.
 *
 * **Facts, not copies.** The response body is hashed (`sha256`, the provenance
 * `contentHash`) and only extracted facts survive — no raw HTML or media is
 * retained or logged. Every observation opens `pending` (human review before any
 * influence, `DEC-020`) and nothing is ever auto-published or applied.
 *
 * **No personal data.** The extractor reads offer/title, category, price,
 * currency and a derivable season only.
 */

/** The cron default (weekly, Monday 07:00) — the scheduler's fallback. */
export const DEFAULT_COMPETITOR_COLLECTION_CRON = "0 7 * * 1";

/** A default identifying user-agent; operators should set a real contact. */
export const DEFAULT_COMPETITOR_USER_AGENT =
  "AquarelaBusinessControl/1.0 (+https://aquarela.example/bot; competitor-price-research)";

/** The bounded page budget for one run when unset. */
export const DEFAULT_COMPETITOR_MAX_PAGES_PER_RUN = 20;

/** The per-host minimum delay (one request per second, `DEC-149`). */
export const DEFAULT_COMPETITOR_MIN_DELAY_MS = 1000;

/** The per-request timeout when unset. */
export const DEFAULT_COMPETITOR_TIMEOUT_MS = 10_000;

/** Bounded retries on a retryable (`429`/`5xx`) response or a network error. */
export const DEFAULT_COMPETITOR_MAX_RETRIES = 2;

/** The exponential backoff base between retries. */
export const DEFAULT_COMPETITOR_RETRY_BASE_DELAY_MS = 1000;

/** A retry never waits longer than this, whatever the response says. */
export const COMPETITOR_RETRY_DELAY_CAP_MS = 30_000;

/** A robots.txt larger than this is treated as unparseable (fail closed). */
export const MAX_ROBOTS_BYTES = 512_000;

/** Only this much of a page is scanned for facts (the full body is still hashed). */
export const MAX_HTML_CHARS = 2_000_000;

/** The most facts a single page contributes. */
export const MAX_FACTS_PER_PAGE = 50;

/** The provenance `method` value for an automated capture. */
export const COMPETITOR_CAPTURE_METHOD = "automated" as const;

/** The subset of a logger the collector uses; keeps it decoupled from pino. */
export interface CollectorLogger {
  info(context: Record<string, unknown>, message: string): void;
  warn(context: Record<string, unknown>, message: string): void;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The observation-level idempotency key (`DEC-149` follow-up). The page hash
 * identifies the fetched body; a page yields several facts, so the key must
 * distinguish them or the partial unique index would collapse a page to one
 * observation. Mixing the page hash with the fact's name and price keeps the key
 * stable for an unchanged capture and distinct per offer.
 */
export function observationContentHash(pageContentHash: string, fact: ExtractedFact): string {
  return sha256Hex(`${pageContentHash}\u0000${fact.externalName}\u0000${fact.price ?? ""}`);
}

// ---------------------------------------------------------------------------
// robots.txt
// ---------------------------------------------------------------------------

export interface RobotsRule {
  readonly allow: boolean;
  readonly pattern: string;
}

export interface RobotsGroup {
  readonly agents: readonly string[];
  readonly rules: readonly RobotsRule[];
}

/** The robots token for the configured user-agent (`Name/1.0 (...)` → `name`). */
export function robotsAgentToken(userAgent: string): string {
  const first = userAgent.trim().split(/[\s/]/u)[0] ?? "";
  return first.toLowerCase();
}

/**
 * Parses a robots.txt body into its user-agent groups. Returns `undefined`
 * (unparseable ⇒ fail closed) for a NUL byte, an over-large body, or any
 * non-comment line that is not `field: value`. Unknown-but-well-formed
 * directives (`Sitemap`, `Crawl-delay`, …) are ignored, as the spec allows.
 */
export function parseRobotsTxt(text: string): readonly RobotsGroup[] | undefined {
  if (text.length > MAX_ROBOTS_BYTES || text.includes("\u0000")) {
    return undefined;
  }
  const groups: RobotsGroup[] = [];
  let current: { agents: string[]; rules: RobotsRule[] } | null = null;

  for (const rawLine of text.split(/\r?\n/u)) {
    const line = rawLine.replace(/#.*$/u, "").trim();
    if (line.length === 0) {
      continue;
    }
    const match = /^([A-Za-z-]+)\s*:\s*(.*)$/u.exec(line);
    if (match === null) {
      return undefined;
    }
    const field = (match[1] ?? "").toLowerCase();
    const value = (match[2] ?? "").trim();

    if (field === "user-agent") {
      if (current !== null && current.rules.length > 0) {
        groups.push(current);
        current = null;
      }
      if (current === null) {
        current = { agents: [], rules: [] };
      }
      current.agents.push(value.toLowerCase());
    } else if (field === "disallow" || field === "allow") {
      if (current === null) {
        current = { agents: ["*"], rules: [] };
      }
      if (current.agents.length === 0) {
        current.agents.push("*");
      }
      // An empty `Disallow:` means "allow everything": encode it as no rule.
      if (field === "disallow" && value.length === 0) {
        continue;
      }
      current.rules.push({ allow: field === "allow", pattern: value });
    }
  }

  if (current !== null && current.rules.length > 0) {
    groups.push(current);
  }
  return groups;
}

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Matches one robots path pattern (with `*` wildcards and an optional `$`). */
export function robotsPatternMatches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const source = `^${body.split("*").map(escapeRegex).join(".*")}${anchored ? "$" : ""}`;
  try {
    return new RegExp(source, "u").test(path);
  } catch {
    return false;
  }
}

/**
 * Whether `path` is allowed for `agentToken` under the parsed groups. The most
 * specific group wins (an exact agent token beats `*`); within a group the
 * longest matching rule wins, and `Allow` beats `Disallow` on a tie (the
 * standard rule-precedence); no matching rule ⇒ allowed.
 */
export function isPathAllowed(
  groups: readonly RobotsGroup[],
  agentToken: string,
  path: string,
): boolean {
  const exact = groups.filter((group) => group.agents.includes(agentToken));
  const chosen = exact.length > 0 ? exact : groups.filter((group) => group.agents.includes("*"));
  if (chosen.length === 0) {
    return true;
  }
  let best: RobotsRule | undefined;
  let bestLength = -1;
  for (const group of chosen) {
    for (const rule of group.rules) {
      if (rule.pattern.length === 0 || !robotsPatternMatches(rule.pattern, path)) {
        continue;
      }
      const length = rule.pattern.replace(/[*$]/gu, "").length;
      if (length > bestLength || (length === bestLength && rule.allow)) {
        best = rule;
        bestLength = length;
      }
    }
  }
  return best === undefined ? true : best.allow;
}

// ---------------------------------------------------------------------------
// Fact extraction (no raw HTML is retained)
// ---------------------------------------------------------------------------

/** One extracted fact from a competitor page. */
export interface ExtractedFact {
  readonly externalName: string;
  readonly price: string | null;
  readonly currency: string | null;
  readonly productCategory: string | null;
  readonly season: string | null;
}

const PRODUCT_TYPES = new Set([
  "product",
  "individualproduct",
  "productgroup",
  "offer",
  "aggregateoffer",
  "menuitem",
]);

function asText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/**
 * Normalises a price to a plain decimal string (`"12,50"` → `"12.50"`, a
 * `"1 234,50"` group → `"1234.50"`). Anything not a finite non-negative number is
 * `null`; the command validates scale and sign again on the way in.
 */
export function normalizePriceValue(value: unknown): string | null {
  let raw: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) {
      return null;
    }
    raw = String(value);
  } else if (typeof value === "string") {
    raw = value;
  } else {
    return null;
  }

  let text = raw
    .trim()
    .replace(/[^\d.,]/gu, "")
    .replace(/[.,]+$/u, "");
  if (text.length === 0) {
    return null;
  }
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  if (lastComma !== -1 && lastDot !== -1) {
    text =
      lastComma > lastDot ? text.replace(/\./gu, "").replace(/,/gu, ".") : text.replace(/,/gu, "");
  } else if (lastComma !== -1) {
    const decimals = text.length - lastComma - 1;
    text = decimals === 3 && text.length > 4 ? text.replace(/,/gu, "") : text.replace(/,/gu, ".");
  }
  if ((text.match(/\./gu) ?? []).length > 1 || !/^\d+(\.\d+)?$/u.test(text)) {
    return null;
  }
  return text;
}

function jsonLdBlocks(html: string): string[] {
  const pattern =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/giu;
  const blocks: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) !== null) {
    if (match[1] !== undefined) {
      blocks.push(match[1]);
    }
  }
  return blocks;
}

function collectJsonLdNodes(value: unknown, out: Record<string, unknown>[]): void {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectJsonLdNodes(item, out);
    }
    return;
  }
  if (!isObject(value)) {
    return;
  }
  out.push(value);
  const graph = value["@graph"];
  if (graph !== undefined) {
    collectJsonLdNodes(graph, out);
  }
}

function isProductLike(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  const types = (Array.isArray(type) ? type : [type]).map((value) =>
    typeof value === "string" ? value.toLowerCase() : "",
  );
  if (types.some((value) => PRODUCT_TYPES.has(value))) {
    return true;
  }
  return node["offers"] !== undefined || node["price"] !== undefined;
}

function readSeason(node: Record<string, unknown>): string | null {
  const direct = asText(node["season"]);
  if (direct !== null) {
    return direct;
  }
  const extras = node["additionalProperty"];
  const list = Array.isArray(extras) ? extras : extras === undefined ? [] : [extras];
  for (const extra of list) {
    if (!isObject(extra)) {
      continue;
    }
    const name = asText(extra["name"]);
    if (name !== null && /season/iu.test(name)) {
      const value = asText(extra["value"]);
      if (value !== null) {
        return value;
      }
    }
  }
  return null;
}

function readPriceAndCurrency(node: Record<string, unknown>): {
  price: string | null;
  currency: string | null;
} {
  let price: string | null = null;
  let currency: string | null = null;
  const offers = node["offers"];
  const first = Array.isArray(offers) ? offers[0] : offers;
  if (isObject(first)) {
    price = normalizePriceValue(first["price"]) ?? normalizePriceValue(first["lowPrice"]);
    currency = asText(first["priceCurrency"]);
  }
  if (price === null) {
    price = normalizePriceValue(node["price"]);
  }
  if (currency === null) {
    currency = asText(node["priceCurrency"]);
  }
  return { price, currency };
}

function readAttribute(tag: string, name: string): string | null {
  const pattern = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "iu");
  const match = pattern.exec(tag);
  if (match === null) {
    return null;
  }
  const value = match[1] ?? match[2] ?? null;
  return value === null || value.trim().length === 0 ? null : value.trim();
}

/** Lower-cased `property`/`name`/`itemprop` → `content` map from `<meta>` tags. */
function readMetaTags(html: string): Map<string, string> {
  const map = new Map<string, string>();
  for (const tag of html.match(/<meta\b[^>]*>/giu) ?? []) {
    const key =
      readAttribute(tag, "property") ??
      readAttribute(tag, "name") ??
      readAttribute(tag, "itemprop");
    const content = readAttribute(tag, "content");
    if (key !== null && content !== null && !map.has(key.toLowerCase())) {
      map.set(key.toLowerCase(), content);
    }
  }
  return map;
}

function readTitleTag(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title\s*>/iu.exec(html);
  const value = match?.[1];
  return value === undefined ? null : asText(value.replace(/<[^>]*>/gu, " "));
}

/**
 * Extracts offer facts from a page: JSON-LD products/offers first, then a
 * `<meta>`/`<title>` fallback. Tolerant by design — an unparseable JSON-LD block
 * is skipped, a fact without a name is dropped, and the result is capped at
 * {@link MAX_FACTS_PER_PAGE}. The source HTML is never returned or stored.
 */
export function extractFactsFromHtml(html: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const seen = new Set<string>();
  const push = (fact: ExtractedFact): void => {
    if (fact.externalName.length === 0) {
      return;
    }
    const key = `${fact.externalName}\u0000${fact.price ?? ""}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    facts.push(fact);
  };

  const bounded = html.length > MAX_HTML_CHARS ? html.slice(0, MAX_HTML_CHARS) : html;

  for (const block of jsonLdBlocks(bounded)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(block);
    } catch {
      continue;
    }
    const nodes: Record<string, unknown>[] = [];
    collectJsonLdNodes(parsed, nodes);
    for (const node of nodes) {
      if (!isProductLike(node)) {
        continue;
      }
      const externalName = asText(node["name"]);
      if (externalName === null) {
        continue;
      }
      const { price, currency } = readPriceAndCurrency(node);
      push({
        externalName,
        price,
        currency,
        productCategory: asText(node["category"]),
        season: readSeason(node),
      });
      if (facts.length >= MAX_FACTS_PER_PAGE) {
        return facts;
      }
    }
  }

  if (facts.length === 0) {
    const meta = readMetaTags(bounded);
    const externalName =
      meta.get("og:title") ??
      meta.get("twitter:title") ??
      meta.get("title") ??
      readTitleTag(bounded) ??
      meta.get("name") ??
      null;
    if (externalName !== null) {
      push({
        externalName,
        price: normalizePriceValue(
          meta.get("product:price:amount") ?? meta.get("og:price:amount") ?? meta.get("price"),
        ),
        currency: asText(meta.get("product:price:currency") ?? meta.get("og:price:currency")),
        productCategory: meta.get("product:category") ?? null,
        season: meta.get("product:season") ?? null,
      });
    }
  }

  return facts;
}

// ---------------------------------------------------------------------------
// The polite fetch client
// ---------------------------------------------------------------------------

export type CollectSkipReason =
  | "invalid-url"
  | "budget-exhausted"
  | "robots-unavailable"
  | "robots-unparseable"
  | "robots-disallow";

export type CollectFailReason = "network-error" | "http-error";

export type CollectOutcome =
  | {
      readonly status: "collected";
      /** The final URL after redirects (`response.url`) or the requested URL. */
      readonly url: string;
      /** ISO instant of the capture. */
      readonly capturedAt: string;
      readonly method: typeof COMPETITOR_CAPTURE_METHOD;
      readonly facts: readonly ExtractedFact[];
      /** `sha256` hex of the response body. */
      readonly contentHash: string;
    }
  | { readonly status: "skipped"; readonly reason: CollectSkipReason }
  | { readonly status: "failed"; readonly reason: CollectFailReason; readonly httpStatus?: number };

export interface CompetitorCollectorOptions {
  readonly userAgent: string;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly timeoutMs?: number | undefined;
  /** The per-host minimum delay (`DEC-149`: default 1000 ms, ≤ 1 req/s). */
  readonly minDelayMs?: number | undefined;
  /** The page budget for this run. */
  readonly maxPagesPerRun?: number | undefined;
  readonly maxRetries?: number | undefined;
  readonly retryBaseDelayMs?: number | undefined;
  /** Injectable sleep/clock so the politeness logic is deterministic in tests. */
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly now?: (() => number) | undefined;
  readonly logger?: CollectorLogger | undefined;
}

/** One collection run: a shared page budget and per-host clock across sources. */
export interface CompetitorCollectorRun {
  collect(sourceUrl: string): Promise<CollectOutcome>;
  readonly pagesFetched: number;
}

type RobotsLookup =
  | { readonly ok: true; readonly groups: readonly RobotsGroup[] }
  | { readonly ok: false; readonly reason: "robots-unavailable" | "robots-unparseable" };

function parseRetryAfterMs(response: Response): number | null {
  const header = response.headers.get("retry-after");
  if (header === null) {
    return null;
  }
  const seconds = Number.parseInt(header.trim(), 10);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  return Math.min(seconds * 1000, COMPETITOR_RETRY_DELAY_CAP_MS);
}

/**
 * Builds the injectable, stateful collector client for one run. Create one run
 * per cron invocation: the page budget and the per-host request clock are shared
 * across every source in the run.
 */
export function createCompetitorCollectorRun(
  options: CompetitorCollectorOptions,
): CompetitorCollectorRun {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_COMPETITOR_TIMEOUT_MS;
  const minDelayMs = options.minDelayMs ?? DEFAULT_COMPETITOR_MIN_DELAY_MS;
  const maxPagesPerRun = options.maxPagesPerRun ?? DEFAULT_COMPETITOR_MAX_PAGES_PER_RUN;
  const maxRetries = options.maxRetries ?? DEFAULT_COMPETITOR_MAX_RETRIES;
  const retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_COMPETITOR_RETRY_BASE_DELAY_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? (() => Date.now());
  const logger = options.logger;
  const agentToken = robotsAgentToken(options.userAgent);

  const lastRequestAt = new Map<string, number>();
  const robotsByOrigin = new Map<string, RobotsLookup>();
  let pagesFetched = 0;

  async function waitForHost(host: string): Promise<void> {
    const last = lastRequestAt.get(host);
    if (last !== undefined) {
      const elapsed = now() - last;
      if (elapsed < minDelayMs) {
        await sleep(minDelayMs - elapsed);
      }
    }
    lastRequestAt.set(host, now());
  }

  function requestInit(): RequestInit {
    return {
      method: "GET",
      headers: {
        "user-agent": options.userAgent,
        accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
      },
      signal: AbortSignal.timeout(timeoutMs),
    };
  }

  async function ensureRobots(origin: string, host: string): Promise<RobotsLookup> {
    const cached = robotsByOrigin.get(origin);
    if (cached !== undefined) {
      return cached;
    }
    let error: unknown;
    try {
      await waitForHost(host);
      const response = await fetchImpl(`${origin}/robots.txt`, requestInit());
      if (!response.ok) {
        // Fail closed: an unavailable robots.txt skips the source.
        const lookup: RobotsLookup = { ok: false, reason: "robots-unavailable" };
        robotsByOrigin.set(origin, lookup);
        return lookup;
      }
      const body = await response.text();
      const groups = parseRobotsTxt(body);
      const lookup: RobotsLookup =
        groups === undefined ? { ok: false, reason: "robots-unparseable" } : { ok: true, groups };
      robotsByOrigin.set(origin, lookup);
      return lookup;
    } catch (cause) {
      error = cause;
    }
    logger?.warn(
      { origin, error: safeErrorMessage(error) },
      "competitor collector: robots.txt could not be fetched; skipping the source",
    );
    const lookup: RobotsLookup = { ok: false, reason: "robots-unavailable" };
    robotsByOrigin.set(origin, lookup);
    return lookup;
  }

  async function fetchPage(url: URL, host: string): Promise<CollectOutcome> {
    for (let attempt = 0; ; attempt += 1) {
      await waitForHost(host);
      let response: Response;
      try {
        response = await fetchImpl(url.toString(), requestInit());
      } catch (error) {
        if (attempt < maxRetries) {
          await sleep(Math.min(retryBaseDelayMs * 2 ** attempt, COMPETITOR_RETRY_DELAY_CAP_MS));
          continue;
        }
        logger?.warn(
          { host, error: safeErrorMessage(error) },
          "competitor collector: page fetch failed",
        );
        return { status: "failed", reason: "network-error" };
      }

      if (response.ok) {
        const body = await response.text();
        const contentHash = sha256Hex(body);
        return {
          status: "collected",
          url: response.url.length > 0 ? response.url : url.toString(),
          capturedAt: new Date(now()).toISOString(),
          method: COMPETITOR_CAPTURE_METHOD,
          facts: extractFactsFromHtml(body),
          contentHash,
        };
      }

      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && attempt < maxRetries) {
        const retryAfter = parseRetryAfterMs(response);
        const backoff = Math.min(retryBaseDelayMs * 2 ** attempt, COMPETITOR_RETRY_DELAY_CAP_MS);
        await sleep(retryAfter === null ? backoff : Math.max(backoff, retryAfter));
        continue;
      }
      logger?.warn(
        { host, status: response.status },
        "competitor collector: page fetch returned a non-success status",
      );
      return { status: "failed", reason: "http-error", httpStatus: response.status };
    }
  }

  return {
    get pagesFetched(): number {
      return pagesFetched;
    },
    async collect(sourceUrl: string): Promise<CollectOutcome> {
      let url: URL;
      try {
        url = new URL(sourceUrl);
      } catch {
        return { status: "skipped", reason: "invalid-url" };
      }
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        return { status: "skipped", reason: "invalid-url" };
      }
      if (pagesFetched >= maxPagesPerRun) {
        logger?.info({ host: url.host }, "competitor collector: page budget exhausted; skipping");
        return { status: "skipped", reason: "budget-exhausted" };
      }

      const robots = await ensureRobots(url.origin, url.host);
      if (!robots.ok) {
        return { status: "skipped", reason: robots.reason };
      }
      if (!isPathAllowed(robots.groups, agentToken, `${url.pathname}${url.search}`)) {
        logger?.info({ host: url.host }, "competitor collector: path disallowed by robots.txt");
        return { status: "skipped", reason: "robots-disallow" };
      }

      pagesFetched += 1;
      return fetchPage(url, url.host);
    },
  };
}

// ---------------------------------------------------------------------------
// The cron producer
// ---------------------------------------------------------------------------

export interface CompetitorCollectionJobData {
  readonly organizationId: string;
}

export type CompetitorCollectionSkipReason = "disabled" | "no-sources";

export type CompetitorCollectionOutcome =
  | { readonly status: "skipped"; readonly reason: CompetitorCollectionSkipReason }
  | {
      readonly status: "completed";
      /** Eligible sources considered (active + automated + approved). */
      readonly sources: number;
      readonly collected: number;
      readonly observations: number;
      /** Facts skipped as duplicates of an already-recorded capture (`DEC-149`). */
      readonly duplicates: number;
      readonly skipped: number;
      readonly failed: number;
    };

export interface CompetitorCollectionRunDeps {
  readonly organizationId: string;
  readonly enabled: boolean;
  readonly store: CompetitorStore;
  readonly collector: CompetitorCollectorRun;
  readonly logger?: CollectorLogger | undefined;
  /** The register page size; defaults to the command's own default. */
  readonly sourceLimit?: number | undefined;
}

/** A source is collectable only when automated, approved and linked to a competitor. */
export function isCollectableSource(source: CompetitorSourceRecord): boolean {
  return source.collectionMode === "automated" && source.termsStatus === "approved";
}

/**
 * One competitor-collection pass. Guard order (each skip is logged, none throws):
 * 1. kill switch — `enabled` false ⇒ skip, no read, no fetch;
 * 2. approved automated sources absent ⇒ skip, no fetch;
 * 3. a source without a `competitor_id` link ⇒ skipped (no guess: an observation
 *    row requires a competitor, so an unlinked source is never attributed);
 * 4. per source: robots (fail closed) → budget → polite fetch → facts;
 * 5. each fact is recorded `pending` with mandatory provenance.
 */
export async function runCompetitorCollection(
  deps: CompetitorCollectionRunDeps,
): Promise<CompetitorCollectionOutcome> {
  const { organizationId, collector, logger, store } = deps;

  if (!deps.enabled) {
    logger?.info({ organizationId }, "competitor collection skipped: kill switch is off");
    return { status: "skipped", reason: "disabled" };
  }

  const limit = deps.sourceLimit;
  const sources = await listCompetitorSources(store, {
    organizationId,
    active: true,
    ...(limit === undefined ? {} : { limit }),
  });
  const eligible = sources.filter(isCollectableSource);
  if (eligible.length === 0) {
    logger?.info(
      { organizationId, sources: sources.length },
      "competitor collection skipped: no active approved automated sources",
    );
    return { status: "skipped", reason: "no-sources" };
  }

  let collected = 0;
  let observations = 0;
  let duplicates = 0;
  let skipped = 0;
  let failed = 0;

  for (const source of eligible) {
    if (source.competitorId === null) {
      logger?.info(
        { organizationId, sourceId: source.id },
        "competitor collector: source has no competitor link; skipping (no competitor id is guessed)",
      );
      skipped += 1;
      continue;
    }

    let outcome: CollectOutcome;
    try {
      outcome = await collector.collect(source.urlOrIdentifier);
    } catch (error) {
      logger?.warn(
        { organizationId, sourceId: source.id, error: safeErrorMessage(error) },
        "competitor collector: source collection threw; continuing",
      );
      failed += 1;
      continue;
    }
    if (outcome.status === "skipped") {
      logger?.info(
        { organizationId, sourceId: source.id, reason: outcome.reason },
        "competitor collector: source was skipped",
      );
      skipped += 1;
      continue;
    }
    if (outcome.status === "failed") {
      logger?.warn(
        {
          organizationId,
          sourceId: source.id,
          reason: outcome.reason,
          status: outcome.httpStatus ?? null,
        },
        "competitor collector: source fetch failed",
      );
      failed += 1;
      continue;
    }

    collected += 1;
    const competitorId = source.competitorId;
    for (const fact of outcome.facts) {
      try {
        const created = await recordCompetitorObservation(store, {
          organizationId,
          actorId: null,
          competitorId,
          observedAt: outcome.capturedAt,
          source: source.sourceType,
          sourceUrl: outcome.url,
          itemId: null,
          externalName: fact.externalName,
          price: fact.price,
          currency: fact.currency,
          offerNotes: null,
          competitorSourceId: source.id,
          captureMethod: COMPETITOR_CAPTURE_METHOD,
          productCategory: fact.productCategory,
          season: fact.season,
          provenance: {
            url: outcome.url,
            capturedAt: outcome.capturedAt,
            method: COMPETITOR_CAPTURE_METHOD,
            contentHash: outcome.contentHash,
          },
          contentHash: observationContentHash(outcome.contentHash, fact),
        });
        if (created === undefined) {
          duplicates += 1;
          logger?.info(
            { organizationId, sourceId: source.id, externalName: fact.externalName },
            "competitor collector: duplicate fact skipped (same source + content hash)",
          );
          continue;
        }
        observations += 1;
      } catch (error) {
        logger?.warn(
          { organizationId, sourceId: source.id, error: safeErrorMessage(error) },
          "competitor collector: observation was rejected and skipped",
        );
      }
    }
  }

  return {
    status: "completed",
    sources: eligible.length,
    collected,
    observations,
    duplicates,
    skipped,
    failed,
  };
}

export interface CompetitorCollectionOptions {
  readonly organizationId: string;
  readonly cron: string;
  readonly enabled: boolean;
  readonly logger?: RuntimeLogger | undefined;
  readonly userAgent?: string | undefined;
  readonly maxPagesPerRun?: number | undefined;
  readonly minDelayMs?: number | undefined;
  readonly timeoutMs?: number | undefined;
  /** Test seams; production uses the postgres store and the real fetch client. */
  readonly store?: CompetitorStore | undefined;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly sleep?: ((ms: number) => Promise<void>) | undefined;
  readonly now?: (() => number) | undefined;
}

/**
 * Registers the competitor-collection cron (`missed: "once"`). The kill switch
 * lives in the handler, so the schedule is always registered and one env flip
 * enables it without a redeploy. The handler never throws: an unexpected failure
 * logs an error rather than dead-lettering (and never causes a retry that would
 * duplicate the day's observations).
 */
export async function registerCompetitorCollection(
  boss: JobsBoss,
  db: NodeDatabase,
  options: CompetitorCollectionOptions,
): Promise<void> {
  const { organizationId, cron, logger } = options;
  const store = options.store ?? createPostgresCompetitorStore(db);

  await boss.work<CompetitorCollectionJobData>(COMPETITOR_COLLECTION_QUEUE, async (jobs) => {
    for (const job of jobs) {
      // The configured organization is the authority; the pg-boss-stored job data
      // is routing metadata only and must never redirect the run.
      const storedOrganizationId = job.data.organizationId;
      if (storedOrganizationId !== undefined && storedOrganizationId !== organizationId) {
        logger?.warn(
          { organizationId, storedOrganizationId },
          "competitor collection job data organizationId differs from the configured organization; using the configured one",
        );
      }

      const collector = createCompetitorCollectorRun({
        userAgent: options.userAgent ?? DEFAULT_COMPETITOR_USER_AGENT,
        fetchImpl: options.fetchImpl,
        timeoutMs: options.timeoutMs,
        minDelayMs: options.minDelayMs,
        maxPagesPerRun: options.maxPagesPerRun,
        logger,
        sleep: options.sleep,
        now: options.now,
      });

      try {
        const outcome = await runCompetitorCollection({
          organizationId,
          enabled: options.enabled,
          store,
          collector,
          logger,
        });
        logger?.info({ organizationId, outcome }, "competitor collection cron run finished");
      } catch (error) {
        logger?.error(
          { organizationId, error: safeErrorMessage(error) },
          "competitor collection cron run failed unexpectedly; not retried",
        );
      }
    }
  });

  await boss.schedule(
    COMPETITOR_COLLECTION_QUEUE,
    cron,
    // Observability only: the handler uses the configured `options.organizationId`.
    { organizationId },
    { missed: "once" },
  );
}
