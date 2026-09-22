import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

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

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

/** `timestamptz`, ISO, or `null` — the adapter's read-side convention. */
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** The write-side twin of `toIso`: an ISO string or `null` becomes a `Date` or `null`. */
function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toEmployee(row: repo.Employee): EmployeeRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    name: row.name,
    roleCode: row.roleCode,
    employmentType: row.employmentType,
    // `numeric(19,4)` crosses the port as a decimal string, never a number.
    baseHourlyRate: row.baseHourlyRate,
    costCenterId: row.costCenterId,
    primaryLocationId: row.primaryLocationId,
    // `date` columns are already `YYYY-MM-DD` strings at the persistence layer.
    activeFrom: row.activeFrom,
    activeTo: row.activeTo,
    retiredAt: toIso(row.retiredAt),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}

function newEmployeeValues(input: NewEmployeeRecord): repo.CreateEmployeeInput {
  return {
    organizationId: input.organizationId,
    userId: input.userId,
    name: input.name,
    roleCode: input.roleCode,
    employmentType: input.employmentType,
    baseHourlyRate: input.baseHourlyRate,
    costCenterId: input.costCenterId,
    primaryLocationId: input.primaryLocationId,
    activeFrom: input.activeFrom,
    activeTo: input.activeTo,
    actorId: input.createdBy,
  };
}

function toEmployeeDocument(row: repo.EmployeeDocument): EmployeeDocumentRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    employeeId: row.employeeId,
    kind: row.kind,
    title: row.title,
    fileObjectId: row.fileObjectId,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}

function newEmployeeDocumentValues(
  input: NewEmployeeDocumentRecord,
): repo.CreateEmployeeDocumentInput {
  return {
    organizationId: input.organizationId,
    employeeId: input.employeeId,
    kind: input.kind,
    title: input.title,
    fileObjectId: input.fileObjectId,
    issuedAt: input.issuedAt,
    expiresAt: input.expiresAt,
    actorId: input.createdBy,
  };
}

/**
 * Adapts the persistence workforce repository to the `WorkforceStore` port: the
 * `timestamptz` columns become ISO strings on read and `Date`s on write, and
 * every read/write passes the organization through so the adapter cannot escape
 * the `DEC-061` row scope. `actorId` is threaded into `created_by`/`updated_by`.
 */
export function createPostgresWorkforceStore(db: Database): WorkforceStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresWorkforceStore(db));
      }
      return db.transaction((tx) => fn(createPostgresWorkforceStore(tx)));
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
    createEmployee: async (input) =>
      toEmployee(await repo.createEmployee(db, newEmployeeValues(input))),
    findEmployee: async (query) => {
      const row = await repo.findEmployee(db, {
        organizationId: query.organizationId,
        employeeId: query.employeeId,
      });
      return row === undefined ? undefined : toEmployee(row);
    },
    updateEmployee: async (input: UpdateEmployeeRecord) => {
      const row = await repo.updateEmployee(db, {
        organizationId: input.organizationId,
        employeeId: input.employeeId,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.roleCode === undefined ? {} : { roleCode: input.roleCode }),
        ...(input.employmentType === undefined ? {} : { employmentType: input.employmentType }),
        ...(input.baseHourlyRate === undefined ? {} : { baseHourlyRate: input.baseHourlyRate }),
        ...(input.costCenterId === undefined ? {} : { costCenterId: input.costCenterId }),
        ...(input.primaryLocationId === undefined
          ? {}
          : { primaryLocationId: input.primaryLocationId }),
        ...(input.activeTo === undefined ? {} : { activeTo: input.activeTo }),
        ...(input.retiredAt === undefined ? {} : { retiredAt: toDate(input.retiredAt) }),
        ...(input.updatedBy === undefined ? {} : { actorId: input.updatedBy }),
      });
      return row === undefined ? undefined : toEmployee(row);
    },
    listEmployees: async (query: EmployeeListQuery) => {
      const rows = await repo.listEmployees(db, {
        organizationId: query.organizationId,
        ...(query.primaryLocationId === undefined
          ? {}
          : { primaryLocationId: query.primaryLocationId }),
        ...(query.active === undefined ? {} : { active: query.active }),
        ...(query.retired === undefined ? {} : { retired: query.retired }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toEmployee);
    },
    createEmployeeDocument: async (input) =>
      toEmployeeDocument(await repo.createEmployeeDocument(db, newEmployeeDocumentValues(input))),
    findEmployeeDocument: async (query) => {
      const row = await repo.findEmployeeDocument(db, {
        organizationId: query.organizationId,
        employeeDocumentId: query.employeeDocumentId,
      });
      return row === undefined ? undefined : toEmployeeDocument(row);
    },
    updateEmployeeDocument: async (input: UpdateEmployeeDocumentRecord) => {
      const row = await repo.updateEmployeeDocument(db, {
        organizationId: input.organizationId,
        employeeDocumentId: input.employeeDocumentId,
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.fileObjectId === undefined ? {} : { fileObjectId: input.fileObjectId }),
        ...(input.issuedAt === undefined ? {} : { issuedAt: input.issuedAt }),
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
        ...(input.updatedBy === undefined ? {} : { actorId: input.updatedBy }),
      });
      return row === undefined ? undefined : toEmployeeDocument(row);
    },
    listEmployeeDocuments: async (query: EmployeeDocumentListQuery) => {
      const rows = await repo.listEmployeeDocuments(db, {
        organizationId: query.organizationId,
        ...(query.employeeId === undefined ? {} : { employeeId: query.employeeId }),
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toEmployeeDocument);
    },
  };
}
