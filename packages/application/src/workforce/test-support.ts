import type { AuditInput } from "../auth";

import { DEFAULT_EMPLOYEE_DOCUMENT_LIMIT } from "./list-employee-documents";
import { DEFAULT_EMPLOYEE_LIMIT } from "./list-employees";
import type {
  EmployeeDocumentListQuery,
  EmployeeDocumentRecord,
  EmployeeListQuery,
  EmployeeRecord,
  NewEmployeeDocumentRecord,
  NewEmployeeRecord,
  UpdateEmployeeDocumentRecord,
  UpdateEmployeeRecord,
  WorkforceStore,
} from "./types";

/**
 * A shallow copy of every mutable map/array a workforce transaction can touch,
 * used to roll back a failed `withTransaction` (the fake runs inline without one).
 */
interface WorkforceSnapshot {
  readonly employees: Map<string, EmployeeRecord>;
  readonly employeeDocuments: Map<string, EmployeeDocumentRecord>;
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
      audits: [...this.audits],
    };
  }

  private restore(snapshot: WorkforceSnapshot): void {
    this.employees.clear();
    for (const [key, value] of snapshot.employees) this.employees.set(key, value);
    this.employeeDocuments.clear();
    for (const [key, value] of snapshot.employeeDocuments) this.employeeDocuments.set(key, value);
    this.audits.length = 0;
    this.audits.push(...snapshot.audits);
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
  }

  async createEmployee(input: NewEmployeeRecord): Promise<EmployeeRecord> {
    const record: EmployeeRecord = {
      id: this.nextId("employee"),
      ...input,
      // A new employee is not retired until the `retireEmployee` command runs.
      retiredAt: null,
      createdAt: new Date().toISOString(),
      updatedBy: null,
    };
    this.employees.set(record.id, record);
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
      ...(input.retiredAt === undefined
        ? {}
        : {
            retiredAt: input.retiredAt === null ? null : new Date(input.retiredAt).toISOString(),
          }),
      ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy }),
    };
    this.employees.set(record.id, record);
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
