import {
  createPostgresSchedulingStore,
  generatePayrollReport,
  listPayrollReports,
} from "@aquarela/application";
import { DomainError, NotFoundError } from "@aquarela/domain";

import { requireSession } from "../../../../../lib/auth";
import { getDb } from "../../../../../lib/db";
import { withMutationGuards } from "../../../../../lib/guards";
import { jsonError, jsonOk, mapErrors } from "../../../../../lib/http";
import { enqueuePayrollReportGeneration } from "../../../../../lib/jobs";
import { resolveOrganization } from "../../../../../lib/organization";
import { readJsonObject } from "../../../../../lib/request";
import { getServerSession } from "../../../../../lib/server-session";

import {
  isWorkforceAuthorized,
  loadWorkforceAccess,
  PAYROLL_REPORT_READ_ROLES,
  PAYROLL_REPORT_WRITE_ROLES,
} from "../access";
import { shiftLimiters } from "../limiters";
import {
  parseGeneratePayrollReportBody,
  parsePayrollReportListQuery,
  toPayrollReportRow,
  toPayrollReportRows,
} from "../workforce-rows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The monthly payroll-input reports for the served organization (`WF-005`, row
 * 14b-2), newest first.
 *
 * Query: optional `status` (one of `payroll_report_status`: `draft`, `generated`,
 * `exported`, `superseded`), `periodStartFrom` (`YYYY-MM-DD`, an inclusive lower
 * bound on `periodStart`) and `limit`/`offset`. Response:
 * `{ ok: true, limit, offset, rows }`. Signed out → 401; a role outside the
 * `Payroll-input reports` row (owner / general_manager / finance / admin —
 * `location_manager` is deliberately excluded (matrix None), and `kitchen`,
 * `front_of_house`, `purchasing` and `analyst` are denied, `07_SECURITY_AND_NFR.md:19`)
 * → 403; a malformed filter or paging value → 400. Never returns another
 * organization's data (`DEC-061`).
 */
export async function GET(request: Request): Promise<Response> {
  return mapErrors(async () => {
    const session = await getServerSession();
    if (session === undefined) {
      return jsonError(401);
    }
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, PAYROLL_REPORT_READ_ROLES)) {
      return jsonError(403);
    }

    const parsed = parsePayrollReportListQuery(new URL(request.url).searchParams);
    if (!parsed.ok) {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();
    const store = createPostgresSchedulingStore(getDb().db);
    const reports = await listPayrollReports(store, {
      organizationId,
      ...(parsed.query.status === undefined ? {} : { status: parsed.query.status }),
      ...(parsed.query.periodStartFrom === undefined
        ? {}
        : { periodStartFrom: parsed.query.periodStartFrom }),
      limit: parsed.query.limit,
      offset: parsed.query.offset,
    });

    return jsonOk({
      limit: parsed.query.limit,
      offset: parsed.query.offset,
      rows: toPayrollReportRows(organizationId, reports),
    });
  });
}

/**
 * Generates one payroll-input report for a period (`WF-005`, row 14b-2). The
 * actor is the session user, the organization the served tenant, and the report
 * is generated **on demand** (the `job`/scheduler is `ADR-0004`-gated, so
 * nothing here schedules it).
 *
 * The body carries `periodStart`/`periodEnd` (`YYYY-MM-DD`, `periodEnd` strictly
 * after `periodStart`); a malformed body or period is a 400 from the parser, as
 * is a command rejection. Generating is limited to owner / general_manager /
 * finance / admin (`location_manager` is matrix None). A command that cannot
 * find a referenced record is a typed `NotFoundError` → 404.
 *
 * **Async mode.** `?async=true` enqueues the generation instead of generating
 * inline and answers `202` with `Location: /api/v1/jobs/<jobId>`; the default
 * (and `?async=false`) is the synchronous `200 + payrollReport`. Any other
 * `async` value is a 400. Session, access, limiter, body parser and error
 * mapping are identical in both modes; only the async branch returns a 202.
 */
export async function POST(request: Request): Promise<Response> {
  return withMutationGuards(request, shiftLimiters.generatePayrollReport, async () => {
    const { session } = await requireSession(request);
    const access = await loadWorkforceAccess(session.userId);
    if (!isWorkforceAuthorized(access, PAYROLL_REPORT_WRITE_ROLES)) {
      return jsonError(403);
    }

    const parsed = parseGeneratePayrollReportBody(await readJsonObject(request));
    if (!parsed.ok) {
      return jsonError(400);
    }

    const asyncParam = new URL(request.url).searchParams.get("async");
    if (asyncParam !== null && asyncParam !== "true" && asyncParam !== "false") {
      return jsonError(400);
    }

    const organizationId = resolveOrganization();

    if (asyncParam === "true") {
      let jobId: string;
      try {
        ({ jobId } = await enqueuePayrollReportGeneration({
          organizationId,
          periodStart: parsed.input.periodStart,
          periodEnd: parsed.input.periodEnd,
        }));
      } catch (error) {
        if (error instanceof DomainError) {
          return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
        }
        throw error;
      }
      const jobUrl = `/api/v1/jobs/${jobId}`;
      // No helper builds a 202/Location; the body mirrors `jsonOk`'s shape so
      // the client can follow `jobUrl` to the existing poll endpoint.
      return Response.json(
        { ok: true, jobId, jobUrl },
        { status: 202, headers: { Location: jobUrl } },
      );
    }

    const store = createPostgresSchedulingStore(getDb().db);

    let report;
    try {
      report = await generatePayrollReport(store, {
        organizationId,
        periodStart: parsed.input.periodStart,
        periodEnd: parsed.input.periodEnd,
        actorId: session.userId,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        return jsonError(error instanceof NotFoundError ? 404 : 400, error.message);
      }
      throw error;
    }

    return jsonOk({ payrollReport: toPayrollReportRow(organizationId, report) });
  });
}
