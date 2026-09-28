import { ROLE_CODE } from "@aquarela/persistence";

import type { AuditInput } from "../auth";

import { DEFAULT_EMPLOYEE_DOCUMENT_LIMIT } from "./list-employee-documents";
import { DEFAULT_EMPLOYEE_LIMIT } from "./list-employees";
import { DEFAULT_POSITION_LIMIT } from "./list-positions";
import type {
  EmployeeDocumentListQuery,
  EmployeeDocumentRecord,
  EmployeeListQuery,
  EmployeeRecord,
  NewEmployeeDocumentRecord,
  NewEmployeeRecord,
  NewPositionRecord,
  PositionListQuery,
  PositionRecord,
  RoleRecord,
  UpdateEmployeeDocumentRecord,
  UpdateEmployeeRecord,
  UpdatePositionRecord,
  WorkforceStore,
} from "./types";

/**
 * A shallow copy of every mutable map/array a workforce transaction can touch,
 * used to roll back a failed `withTransaction` (the fake runs inline without one).
 */
interface WorkforceSnapshot {
  readonly employees: Map<string, EmployeeRecord>;
  readonly employeeDocuments: Map<string, EmployeeDocumentRecord>;
  readonly positions: Map<string, PositionRecord>;
  readonly employeePositions: Map<string, string[]>;
  readonly audits: AuditInput[];
}

/**
 * In-memory `WorkforceStore` for the unit suite. It mirrors the Postgres
 * adapter's organization scoping, ordering and paging so the commands and
 * queries can be exercised without a database; `workforce.postgres.test.ts`
 * covers the real adapter.
 */
export class FakeWorkforceStore implements WorkforceStore {
  readonly employees = new Map<string, EmployeeRecord>();
  readonly employeeDocuments = new Map<string, EmployeeDocumentRecord>();
  readonly positions = new Map<string, PositionRecord>();
  readonly employeePositions = new Map<string, string[]>();
  /** Explicit role rows; a `ROLE_CODE` code is also accepted as if seeded. */
  readonly roles = new Map<string, RoleRecord>();
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async withTransaction<T>(fn: (store: WorkforceStore) => Promise<T>): Promise<T> {
    // Snapshot then run so a failure mid-transaction rolls back every write
    // (a create and its audit fact commit or roll back together, like the
    // Postgres adapter).
    const snapshot = this.snapshot();
    try {
      return await fn(this);
    } catch (error) {
      this.restore(snapshot);
      throw error;
    }
  }

  private snapshot(): WorkforceSnapshot {
    return {
      employees: new Map(this.employees),
      employeeDocuments: new Map(this.employeeDocuments),
      positions: new Map(this.positions),
      employeePositions: new Map(
        [...this.employeePositions].map(([key, value]) => [key, [...value]]),
      ),
      audits: [...this.audits],
    };
  }

  private restore(snapshot: WorkforceSnapshot): void {
    this.employees.clear();
    for (const [key, value] of snapshot.employees) this.employees.set(key, value);
    this.employeeDocuments.clear();
    for (const [key, value] of snapshot.employeeDocuments) this.employeeDocuments.set(key, value);
    this.positions.clear();
    for (const [key, value] of snapshot.positions) this.positions.set(key, value);
    this.employeePositions.clear();
    for (const [key, value] of snapshot.employeePositions) this.employeePositions.set(key, value);
    this.audits.length = 0;
    this.audits.push(...snapshot.audits);
  }

  /** Seeds a role row explicitly (the fixed vocabulary is otherwise accepted). */
  seedRole(organizationId: string, code: string): void {
    this.roles.set(`${organizationId}:${code}`, {
      id: this.nextId("role"),
      organizationId,
      code,
    });
  }

  /** Seeds one position in the catalogue and returns it. */
  seedPosition(
    organizationId: string,
    overrides: Partial<PositionRecord> & Pick<PositionRecord, "code" | "name">,
  ): PositionRecord {
    const record: PositionRecord = {
      id: overrides.id ?? this.nextId("position"),
      organizationId,
      code: overrides.code,
      name: overrides.name,
      activeFrom: overrides.activeFrom ?? "2026-01-01",
      activeTo: overrides.activeTo ?? null,
      createdAt: new Date().toISOString(),
      createdBy: overrides.createdBy ?? null,
      updatedAt: null,
      updatedBy: null,
    };
    this.positions.set(record.id, record);
    return record;
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
  }

  async createEmployee(input: NewEmployeeRecord): Promise<EmployeeRecord> {
    const record: EmployeeRecord = {
      id: this.nextId("employee"),
      ...input,
      positionIds: [...input.positionIds],
      // A new employee is not retired until the `retireEmployee` command runs.
      retiredAt: null,
      createdAt: new Date().toISOString(),
      updatedBy: null,
    };
    this.employees.set(record.id, record);
    this.employeePositions.set(record.id, [...input.positionIds]);
    return record;
  }

  async findEmployee(query: {
    readonly organizationId: string;
    readonly employeeId: string;
  }): Promise<EmployeeRecord | undefined> {
    const employee = this.employees.get(query.employeeId);
    return employee !== undefined && employee.organizationId === query.organizationId
      ? employee
      : undefined;
  }

  async updateEmployee(input: UpdateEmployeeRecord): Promise<EmployeeRecord | undefined> {
    const existing = await this.findEmployee({
      organizationId: input.organizationId,
      employeeId: input.employeeId,
    });
    if (existing === undefined) return undefined;
    // Replace the record rather than mutate it: the transaction snapshot keeps
    // the old object reference, so an in-place edit would survive a rollback.
    const record: EmployeeRecord = {
      ...existing,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.roleCode === undefined ? {} : { roleCode: input.roleCode }),
      ...(input.employmentType === undefined ? {} : { employmentType: input.employmentType }),
      ...(input.baseHourlyRate === undefined ? {} : { baseHourlyRate: input.baseHourlyRate }),
      ...(input.costCenterId === undefined ? {} : { costCenterId: input.costCenterId }),
      ...(input.primaryLocationId === undefined
        ? {}
        : { primaryLocationId: input.primaryLocationId }),
      ...(input.activeTo === undefined ? {} : { activeTo: input.activeTo }),
      ...(input.positionIds === undefined ? {} : { positionIds: [...input.positionIds] }),
      ...(input.retiredAt === undefined
        ? {}
        : {
            retiredAt: input.retiredAt === null ? null : new Date(input.retiredAt).toISOString(),
          }),
      ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy }),
    };
    this.employees.set(record.id, record);
    if (input.positionIds !== undefined) {
      this.employeePositions.set(record.id, [...input.positionIds]);
    }
    return record;
  }

  async listEmployees(query: EmployeeListQuery): Promise<readonly EmployeeRecord[]> {
    const rows = [...this.employees.values()]
      .filter((employee) => employee.organizationId === query.organizationId)
      .filter(
        (employee) =>
          query.primaryLocationId === undefined ||
          employee.primaryLocationId === query.primaryLocationId,
      )
      .filter((employee) =>
        query.active === undefined
          ? true
          : query.active
            ? employee.retiredAt === null
            : employee.retiredAt !== null,
      )
      .filter((employee) =>
        query.retired === undefined
          ? true
          : query.retired
            ? employee.retiredAt !== null
            : employee.retiredAt === null,
      )
      .sort((a, b) => {
        if (a.name !== b.name) return a.name < b.name ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
    const offset = query.offset ?? 0;
    // Default to the application page cap, mirroring the Postgres adapter and
    // the commands: an omitted `limit` must never hand back the whole register.
    const limit = query.limit ?? DEFAULT_EMPLOYEE_LIMIT;
    return rows.slice(offset, offset + limit);
  }

  async createEmployeeDocument(input: NewEmployeeDocumentRecord): Promise<EmployeeDocumentRecord> {
    const record: EmployeeDocumentRecord = {
      id: this.nextId("employee-document"),
      ...input,
      createdAt: new Date().toISOString(),
      updatedBy: null,
    };
    this.employeeDocuments.set(record.id, record);
    return record;
  }

  async findEmployeeDocument(query: {
    readonly organizationId: string;
    readonly employeeDocumentId: string;
  }): Promise<EmployeeDocumentRecord | undefined> {
    const document = this.employeeDocuments.get(query.employeeDocumentId);
    return document !== undefined && document.organizationId === query.organizationId
      ? document
      : undefined;
  }

  async updateEmployeeDocument(
    input: UpdateEmployeeDocumentRecord,
  ): Promise<EmployeeDocumentRecord | undefined> {
    const existing = await this.findEmployeeDocument({
      organizationId: input.organizationId,
      employeeDocumentId: input.employeeDocumentId,
    });
    if (existing === undefined) return undefined;
    // Replace the record rather than mutate it: the transaction snapshot keeps
    // the old object reference, so an in-place edit would survive a rollback.
    const record: EmployeeDocumentRecord = {
      ...existing,
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.fileObjectId === undefined ? {} : { fileObjectId: input.fileObjectId }),
      ...(input.issuedAt === undefined ? {} : { issuedAt: input.issuedAt }),
      ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
      ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy }),
    };
    this.employeeDocuments.set(record.id, record);
    return record;
  }

  async listEmployeeDocuments(
    query: EmployeeDocumentListQuery,
  ): Promise<readonly EmployeeDocumentRecord[]> {
    const rows = [...this.employeeDocuments.values()]
      .filter((document) => document.organizationId === query.organizationId)
      .filter(
        (document) => query.employeeId === undefined || document.employeeId === query.employeeId,
      )
      .filter((document) => query.kind === undefined || document.kind === query.kind)
      .sort((a, b) => {
        if (a.title !== b.title) return a.title < b.title ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
    const offset = query.offset ?? 0;
    // Mirror the document command's page cap: an omitted `limit` is bounded.
    const limit = query.limit ?? DEFAULT_EMPLOYEE_DOCUMENT_LIMIT;
    return rows.slice(offset, offset + limit);
  }

  async findRoleByCode(query: {
    readonly organizationId: string;
    readonly code: string;
  }): Promise<RoleRecord | undefined> {
    const seeded = this.roles.get(`${query.organizationId}:${query.code}`);
    if (seeded !== undefined) return seeded;
    // The fixed access vocabulary is present in every real organization
    // (`bootstrap`/`role`), so the fake accepts a `ROLE_CODE` member as if seeded.
    return (ROLE_CODE as readonly string[]).includes(query.code)
      ? { id: `role-${query.code}`, organizationId: query.organizationId, code: query.code }
      : undefined;
  }

  async createPosition(input: NewPositionRecord): Promise<PositionRecord> {
    const record: PositionRecord = {
      id: this.nextId("position"),
      organizationId: input.organizationId,
      code: input.code,
      name: input.name,
      activeFrom: input.activeFrom,
      activeTo: input.activeTo,
      createdAt: new Date().toISOString(),
      createdBy: input.createdBy,
      updatedAt: null,
      updatedBy: null,
    };
    this.positions.set(record.id, record);
    return record;
  }

  async findPosition(query: {
    readonly organizationId: string;
    readonly positionId: string;
  }): Promise<PositionRecord | undefined> {
    const position = this.positions.get(query.positionId);
    return position !== undefined && position.organizationId === query.organizationId
      ? position
      : undefined;
  }

  async findPositionByCode(query: {
    readonly organizationId: string;
    readonly code: string;
  }): Promise<PositionRecord | undefined> {
    return [...this.positions.values()].find(
      (position) =>
        position.organizationId === query.organizationId && position.code === query.code,
    );
  }

  async updatePosition(input: UpdatePositionRecord): Promise<PositionRecord | undefined> {
    const existing = await this.findPosition({
      organizationId: input.organizationId,
      positionId: input.positionId,
    });
    if (existing === undefined) return undefined;
    const record: PositionRecord = {
      ...existing,
      ...(input.code === undefined ? {} : { code: input.code }),
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.activeFrom === undefined ? {} : { activeFrom: input.activeFrom }),
      ...(input.activeTo === undefined ? {} : { activeTo: input.activeTo }),
      updatedAt: new Date().toISOString(),
      ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy }),
    };
    this.positions.set(record.id, record);
    return record;
  }

  async listPositions(query: PositionListQuery): Promise<readonly PositionRecord[]> {
    const today = new Date().toISOString().slice(0, 10);
    const rows = [...this.positions.values()]
      .filter((position) => position.organizationId === query.organizationId)
      .filter((position) =>
        query.active === undefined
          ? true
          : query.active
            ? position.activeTo === null || position.activeTo > today
            : position.activeTo !== null && position.activeTo <= today,
      )
      .sort((a, b) => {
        if (a.name !== b.name) return a.name < b.name ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? DEFAULT_POSITION_LIMIT;
    return rows.slice(offset, offset + limit);
  }

  async setEmployeePositions(input: {
    readonly organizationId: string;
    readonly employeeId: string;
    readonly positionIds: readonly string[];
    readonly actorId: string | null;
  }): Promise<void> {
    this.employeePositions.set(input.employeeId, [...input.positionIds]);
    const employee = this.employees.get(input.employeeId);
    if (employee !== undefined) {
      this.employees.set(employee.id, { ...employee, positionIds: [...input.positionIds] });
    }
  }

  async listEmployeePositions(query: {
    readonly organizationId: string;
    readonly employeeId: string;
  }): Promise<readonly PositionRecord[]> {
    const ids = this.employeePositions.get(query.employeeId) ?? [];
    return ids
      .map((id) => this.positions.get(id))
      .filter((position): position is PositionRecord => position !== undefined)
      .sort((a, b) => {
        if (a.name !== b.name) return a.name < b.name ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
  }

  async listPositionIdsByEmployeeIds(query: {
    readonly organizationId: string;
    readonly employeeIds: readonly string[];
  }): Promise<ReadonlyMap<string, readonly string[]>> {
    const map = new Map<string, readonly string[]>();
    for (const employeeId of query.employeeIds) {
      map.set(employeeId, this.employeePositions.get(employeeId) ?? []);
    }
    return map;
  }
}

export interface WorkforceFixture {
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  readonly otherLocationId: string;
}

/**
 * Seeds the two-organization fixture the workforce tests share: a primary
 * location id in each organization so an employee can be registered in one and
 * read from the other, plus the acting actor.
 */
export function seedWorkforceFixture(): WorkforceFixture {
  return {
    organizationId: "org-1",
    otherOrganizationId: "org-2",
    actorId: "actor-1",
    locationId: "loc-1",
    otherLocationId: "loc-2",
  };
}
