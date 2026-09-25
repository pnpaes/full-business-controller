import {
  createPostgresDataQualityReadStore,
  createPostgresInventoryStore,
  createPostgresMasterDataStore,
  listAuditEvents,
  listDataQualityExceptions,
  listLocations,
  listRoles,
  listUnits,
  listUsers,
  loadUserAccess,
} from "@aquarela/application";
import {
  Badge,
  DataTable,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
  Table,
  Td,
  Th,
  color,
  geometry,
  spacing,
  typography,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getAuthStore } from "../../../lib/auth";
import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";

import {
  ADMIN_AUDIT_READ_ROLES,
  ADMIN_DATA_QUALITY_READ_ROLES,
  ADMIN_UNIT_READ_ROLES,
  ADMIN_USERS_ROLES,
  isAdministrationAuthorized,
} from "../../api/v1/administration/access";
import { toRoleRow, toUserRow } from "../../api/v1/administration/admin-rows";

import { UnitConversionForm } from "./unit-conversion-form";
import { UserAccessManager } from "./user-access-manager";

export const dynamic = "force-dynamic";
export const metadata = { title: "Administration — Aquarela Business Control" };

/**
 * Administration hub (08_UI_UX.md §8.3: users/scopes, tax/rules, units,
 * imports, integrations, audit and data quality). Capabilities with an existing
 * screen and application service are linked or rendered — Imports, the
 * conversion graph, the unit register, the data-quality exception register, the
 * audit register and the users & access management surface. Each read is gated on
 * the caller's live roles (`loadUserAccess`, ADR-0003), so a role without read
 * sees nothing rather than an empty register. Tax/rules and integrations still
 * have no application service and no route, so they stay listed as unavailable;
 * user *creation* is absent for the open security decision stated on the surface.
 */

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
} as const;

const list = {
  margin: 0,
  padding: 0,
  listStyle: "none",
  display: "flex",
  flexDirection: "column",
  gap: spacing[2],
  color: color.text.secondary,
  fontSize: typography.fontSize.md,
} as const;

const link = {
  color: color.brand.navy,
  fontWeight: typography.fontWeight.semibold,
} as const;

const backLink = {
  ...link,
  alignSelf: "flex-start",
  minHeight: geometry.touchTarget,
  display: "inline-flex",
  alignItems: "center",
} as const;

const muted = {
  color: color.text.secondary,
} as const;

const numCell = { textAlign: "right", fontVariantNumeric: "tabular-nums" } as const;

/** Trims trailing zeros from a canonical decimal string without changing its value. */
function trimDecimal(value: string): string {
  if (!value.includes(".")) {
    return value;
  }
  const trimmed = value.replace(/\.?0+$/, "");
  return trimmed.length === 0 ? "0" : trimmed;
}

/** Locale-aware Norwegian date (§7.8: locale-aware presentation, canonical storage). */
const norwegianDate = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

/** ISO instant or `yyyy-mm-dd` day → `dd.MM.yyyy`; `null`/unparseable → an em dash. */
function formatNorwegianDate(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const date = value.length === 10 ? new Date(`${value}T00:00:00Z`) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : norwegianDate.format(date);
}

const norwegianDateTime = new Intl.DateTimeFormat("nb-NO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

/** ISO instant → `dd.MM.yyyy HH:mm`; unparseable → an em dash. */
function formatNorwegianDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : norwegianDateTime.format(date);
}

type PillTone = "success" | "warning" | "danger" | "info";

/** Exception severity → status tone (`low`/`medium`/`high`/`critical`). */
function severityTone(severity: string): PillTone {
  switch (severity) {
    case "critical":
    case "high":
      return "danger";
    case "medium":
      return "warning";
    default:
      return "info";
  }
}

/** Exception status → status tone (`open`/`acknowledged`/`resolved`/`dismissed`). */
function exceptionStatusTone(status: string): PillTone {
  switch (status) {
    case "open":
      return "warning";
    case "resolved":
      return "success";
    default:
      return "info";
  }
}

export default async function AdministrationPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const organizationId = resolveOrganization();
  const store = createPostgresMasterDataStore(getDb().db);
  const access = await loadUserAccess(getAuthStore(), session.userId);
  const canReadUnits = isAdministrationAuthorized(access, ADMIN_UNIT_READ_ROLES);
  const canReadDataQuality = isAdministrationAuthorized(access, ADMIN_DATA_QUALITY_READ_ROLES);
  const canReadAudit = isAdministrationAuthorized(access, ADMIN_AUDIT_READ_ROLES);
  const canManageUsers = isAdministrationAuthorized(access, ADMIN_USERS_ROLES);
  const asOf = new Date();
  const conversions = await store.listEffectiveConversions(organizationId, asOf, null);
  const units = canReadUnits ? await listUnits(store, { organizationId }) : [];
  const exceptions = canReadDataQuality
    ? await listDataQualityExceptions(createPostgresDataQualityReadStore(getDb().db), {
        organizationId,
      })
    : [];
  const auditEvents = canReadAudit ? await listAuditEvents(getAuthStore(), { organizationId }) : [];
  const users = canManageUsers ? await listUsers(getAuthStore(), { organizationId }) : [];
  const roles = canManageUsers ? await listRoles(getAuthStore(), { organizationId }) : [];
  const locations = canManageUsers
    ? await listLocations(createPostgresInventoryStore(getDb().db), { organizationId })
    : [];
  const knownCodes = [
    ...new Set(conversions.flatMap((edge) => [edge.fromUnit.code, edge.toUnit.code])),
  ];

  return (
    <div style={contentColumn}>
      <PageHeader
        title="Administration"
        scope="Aquarela Business Control"
        description="Configuration and oversight areas. Only capabilities with an existing screen are linked; the rest stay listed with the reason they are not available yet."
      />
      <SectionCard title="Available" meta="Linked screens">
        <ul style={list}>
          <li>
            <a href="/sales/import" style={link}>
              Imports
            </a>{" "}
            — sales import history: register, stage, validate, map and preview runs at{" "}
            <span style={muted}>/sales/import</span>.
          </li>
        </ul>
      </SectionCard>

      <SectionCard title="Units & conversions" meta={`${conversions.length} effective · FND-003`}>
        {conversions.length === 0 ? (
          <EmptyState title="No unit conversions defined">
            A conversion is an effective-dated factor between two units (1 <em>from</em> = factor ×{" "}
            <em>to</em>). Add the org-wide conversions below; item-specific pack/density conversions
            live on the item detail screen.
          </EmptyState>
        ) : (
          <div style={{ overflowX: "auto", minWidth: 0 }}>
            <Table
              caption="Org-wide unit conversions effective now, resolved at the request time."
              columnCount={4}
            >
              <thead>
                <tr>
                  <Th>From</Th>
                  <Th>To</Th>
                  <Th style={numCell}>Factor</Th>
                  <Th>Effective</Th>
                </tr>
              </thead>
              <tbody>
                {conversions.map((edge) => (
                  <tr
                    key={`${edge.fromUnit.id}:${edge.toUnit.id}:${edge.effectiveFrom.toISOString()}`}
                  >
                    <Td>{edge.fromUnit.code}</Td>
                    <Td>{edge.toUnit.code}</Td>
                    <Td style={numCell}>{trimDecimal(edge.factor)}</Td>
                    <Td>
                      {edge.effectiveFrom.toISOString().slice(0, 10)}
                      {" → "}
                      {edge.effectiveTo === null
                        ? "open"
                        : edge.effectiveTo.toISOString().slice(0, 10)}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        <details style={{ marginTop: spacing[4] }}>
          <summary
            style={{
              cursor: "pointer",
              minHeight: geometry.touchTarget,
              display: "flex",
              alignItems: "center",
              fontWeight: typography.fontWeight.semibold,
              color: color.brand.navy,
            }}
          >
            New conversion
          </summary>
          <div style={{ marginTop: spacing[4] }}>
            <UnitConversionForm knownCodes={knownCodes} />
          </div>
        </details>
      </SectionCard>

      {canReadUnits ? (
        <SectionCard title="Units" meta={`${units.length} shown · FND-003`}>
          {units.length === 0 ? (
            <EmptyState title="No units registered yet">
              Units of measure are registered by the catalogue service. None exist for this
              organization yet.
            </EmptyState>
          ) : (
            <div style={{ overflowX: "auto", minWidth: 0 }}>
              <DataTable
                caption="Units of measure registered for this organization, ordered by code."
                columns={[
                  { key: "code", header: "Code" },
                  { key: "dimension", header: "Dimension" },
                  { key: "base", header: "Base unit" },
                ]}
                rows={units.map((unit) => ({
                  code: unit.code,
                  dimension: unit.dimension,
                  base: unit.isBase ? <Badge>base</Badge> : "—",
                }))}
                emptyMessage="No units registered yet."
              />
            </div>
          )}
        </SectionCard>
      ) : null}

      {canReadDataQuality ? (
        <SectionCard title="Data quality" meta={`${exceptions.length} shown · DQ-001`}>
          {exceptions.length === 0 ? (
            <EmptyState title="No exceptions recorded yet">
              The data-quality rules (completeness, freshness, reconciliation, variance) have not
              recorded an exception for this organization yet.
            </EmptyState>
          ) : (
            <div style={{ overflowX: "auto", minWidth: 0 }}>
              <DataTable
                caption="Data-quality exceptions for this organization, newest first."
                columns={[
                  { key: "rule", header: "Rule" },
                  { key: "entity", header: "Entity" },
                  { key: "severity", header: "Severity" },
                  { key: "status", header: "Status" },
                  { key: "detected", header: "Detected" },
                  { key: "due", header: "Due" },
                ]}
                rows={exceptions.map((row) => ({
                  rule: row.ruleCode,
                  entity: `${row.entityType} · ${row.entityId.slice(0, 8)}`,
                  severity: (
                    <StatusPill tone={severityTone(row.severity)}>{row.severity}</StatusPill>
                  ),
                  status: (
                    <StatusPill tone={exceptionStatusTone(row.status)}>{row.status}</StatusPill>
                  ),
                  detected: formatNorwegianDate(row.detectedAt),
                  due: formatNorwegianDate(row.dueDate),
                }))}
                emptyMessage="No exceptions recorded yet."
              />
            </div>
          )}
        </SectionCard>
      ) : null}

      {canReadAudit ? (
        <SectionCard title="Audit" meta={`${auditEvents.length} shown · §7.3`}>
          {auditEvents.length === 0 ? (
            <EmptyState title="No audit events recorded yet">
              Audit events are appended by every create, update, retire, post, approve, reject,
              reverse, close, export and security change. None exist for this organization yet.
            </EmptyState>
          ) : (
            <div style={{ overflowX: "auto", minWidth: 0 }}>
              <DataTable
                caption="Audit events for this organization, newest first."
                columns={[
                  { key: "time", header: "Time" },
                  { key: "action", header: "Action" },
                  { key: "entity", header: "Entity" },
                  { key: "actor", header: "Actor" },
                  { key: "reason", header: "Reason" },
                ]}
                rows={auditEvents.map((row) => ({
                  time: formatNorwegianDateTime(row.occurredAt),
                  action: row.action,
                  entity:
                    row.entityId === null
                      ? row.entityType
                      : `${row.entityType} · ${row.entityId.slice(0, 8)}`,
                  actor: row.actorId === null ? "—" : row.actorId.slice(0, 8),
                  reason: row.reason ?? "—",
                }))}
                emptyMessage="No audit events recorded yet."
              />
            </div>
          )}
        </SectionCard>
      ) : null}

      {canManageUsers ? (
        <SectionCard title="Users & access" meta={`${users.length} shown · §7.1`}>
          <UserAccessManager
            users={users.map(toUserRow)}
            roles={roles.map(toRoleRow)}
            locations={locations.map((location) => ({
              id: location.id,
              code: location.code,
              name: location.name,
            }))}
          />
        </SectionCard>
      ) : null}

      <SectionCard title="Not available yet" headingLevel={3} meta="No backend">
        <ul style={list}>
          <li>
            <Badge>No backend</Badge> Tax/rules — no tax or rule configuration service or screen
            exists yet.
          </li>
          <li>
            <Badge>No backend</Badge> Integrations — no integration configuration service or screen
            exists yet.
          </li>
        </ul>
      </SectionCard>
      <a href="/" style={backLink}>
        Back to Management home
      </a>
    </div>
  );
}
