import * as repo from "@aquarela/persistence";
import type { Database, NodeDatabase } from "@aquarela/persistence";

import type {
  ChecklistRunListQuery,
  ChecklistRunRecord,
  ChecklistTemplateListQuery,
  ChecklistTemplateRecord,
  CorrectiveActionListQuery,
  CorrectiveActionRecord,
  HmsStore,
  IncidentListQuery,
  IncidentRecord,
  MonitoringPointListQuery,
  MonitoringPointRecord,
  MonitoringReadingListQuery,
  MonitoringReadingRecord,
  NewChecklistRunRecord,
  NewChecklistTemplateRecord,
  NewCorrectiveActionRecord,
  NewIncidentRecord,
  NewMonitoringPointRecord,
  NewMonitoringReadingRecord,
  UpdateChecklistRunRecord,
  UpdateChecklistTemplateRecord,
  UpdateCorrectiveActionRecord,
  UpdateIncidentRecord,
} from "./types";

/** A transaction handle has no `transaction` method of its own. */
function isNodeDatabase(db: Database): db is NodeDatabase {
  return typeof (db as NodeDatabase).transaction === "function";
}

function toMonitoringPoint(row: repo.MonitoringPoint): MonitoringPointRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    storageAreaId: row.storageAreaId,
    code: row.code,
    name: row.name,
    kind: row.kind,
    unit: row.unit,
    targetMin: row.targetMin,
    targetMax: row.targetMax,
    checkFrequency: row.checkFrequency,
    active: row.active,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
  };
}

function toMonitoringReading(row: repo.MonitoringReading): MonitoringReadingRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    monitoringPointId: row.monitoringPointId,
    value: row.value,
    unit: row.unit,
    measuredAt: row.measuredAt.toISOString(),
    recordedBy: row.recordedBy,
    inRange: row.inRange,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
  };
}

function newPointValues(input: NewMonitoringPointRecord): repo.NewMonitoringPoint {
  return {
    organizationId: input.organizationId,
    locationId: input.locationId,
    storageAreaId: input.storageAreaId,
    code: input.code,
    name: input.name,
    kind: input.kind,
    unit: input.unit,
    targetMin: input.targetMin,
    targetMax: input.targetMax,
    checkFrequency: input.checkFrequency,
    createdBy: input.createdBy,
  };
}

function newReadingValues(input: NewMonitoringReadingRecord): repo.NewMonitoringReading {
  return {
    organizationId: input.organizationId,
    monitoringPointId: input.monitoringPointId,
    value: input.value,
    unit: input.unit,
    measuredAt: new Date(input.measuredAt),
    recordedBy: input.recordedBy,
    inRange: input.inRange,
    notes: input.notes,
  };
}

/** `timestamptz`, ISO, or `null` — the adapter's read-side convention. */
function toIso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** The write-side twin of `toIso`: an ISO string or `null` becomes a `Date` or `null`. */
function toDate(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}

function toIncident(row: repo.HmsIncident): IncidentRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    locationId: row.locationId,
    category: row.category,
    severity: row.severity,
    occurredAt: row.occurredAt.toISOString(),
    reportedAt: row.reportedAt.toISOString(),
    reportedBy: row.reportedBy,
    ownerId: row.ownerId,
    title: row.title,
    description: row.description,
    dueDate: row.dueDate,
    involvesPersonalData: row.involvesPersonalData,
    status: row.status,
    closedAt: toIso(row.closedAt),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}

function newIncidentValues(input: NewIncidentRecord): repo.CreateIncidentInput {
  return {
    organizationId: input.organizationId,
    locationId: input.locationId,
    category: input.category,
    severity: input.severity,
    occurredAt: new Date(input.occurredAt),
    reportedAt: new Date(input.reportedAt),
    reportedBy: input.reportedBy,
    ownerId: input.ownerId,
    title: input.title,
    description: input.description,
    dueDate: input.dueDate,
    involvesPersonalData: input.involvesPersonalData,
    status: input.status,
    actorId: input.createdBy,
  };
}

function toCorrectiveAction(row: repo.CorrectiveAction): CorrectiveActionRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    incidentId: row.incidentId,
    monitoringReadingId: row.monitoringReadingId,
    description: row.description,
    ownerId: row.ownerId,
    dueDate: row.dueDate,
    status: row.status,
    completedAt: toIso(row.completedAt),
    verifiedBy: row.verifiedBy,
    verifiedAt: toIso(row.verifiedAt),
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}

function newCorrectiveActionValues(
  input: NewCorrectiveActionRecord,
): repo.CreateCorrectiveActionInput {
  return {
    organizationId: input.organizationId,
    incidentId: input.incidentId,
    monitoringReadingId: input.monitoringReadingId,
    description: input.description,
    ownerId: input.ownerId,
    dueDate: input.dueDate,
    status: input.status,
    actorId: input.createdBy,
  };
}

function toChecklistTemplate(row: repo.ChecklistTemplate): ChecklistTemplateRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    category: row.category,
    frequency: row.frequency,
    items: row.items,
    active: row.active,
    supersedesId: row.supersedesId,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}

function newChecklistTemplateValues(
  input: NewChecklistTemplateRecord,
): repo.CreateChecklistTemplateInput {
  return {
    organizationId: input.organizationId,
    name: input.name,
    category: input.category,
    frequency: input.frequency,
    items: input.items,
    active: input.active,
    supersedesId: input.supersedesId,
    actorId: input.createdBy,
  };
}

function toChecklistRun(row: repo.ChecklistRun): ChecklistRunRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    templateId: row.templateId,
    locationId: row.locationId,
    runAt: row.runAt.toISOString(),
    performedBy: row.performedBy,
    status: row.status,
    results: row.results,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    createdBy: row.createdBy,
    updatedBy: row.updatedBy,
  };
}

function newChecklistRunValues(input: NewChecklistRunRecord): repo.CreateChecklistRunInput {
  return {
    organizationId: input.organizationId,
    templateId: input.templateId,
    locationId: input.locationId,
    runAt: new Date(input.runAt),
    performedBy: input.performedBy,
    status: input.status,
    results: input.results,
    notes: input.notes,
    actorId: input.createdBy,
  };
}

/**
 * Adapts the persistence monitoring repository to the `HmsStore` port: the
 * `timestamptz` columns become ISO strings on read and `Date`s on write, and
 * every read/write passes the organization through so the adapter cannot escape
 * the `DEC-061` row scope.
 */
export function createPostgresHmsStore(db: Database): HmsStore {
  return {
    withTransaction: async (fn) => {
      if (!isNodeDatabase(db)) {
        return fn(createPostgresHmsStore(db));
      }
      return db.transaction((tx) => fn(createPostgresHmsStore(tx)));
    },
    writeAudit: async (input) => {
      await repo.writeAuditEvent(db, input);
    },
    createMonitoringPoint: async (input) =>
      toMonitoringPoint(await repo.createMonitoringPoint(db, newPointValues(input))),
    findMonitoringPoint: async (query) => {
      const row = await repo.findMonitoringPoint(db, {
        organizationId: query.organizationId,
        monitoringPointId: query.monitoringPointId,
      });
      return row === undefined ? undefined : toMonitoringPoint(row);
    },
    updateMonitoringPoint: async (input) => {
      const row = await repo.updateMonitoringPoint(db, {
        organizationId: input.organizationId,
        monitoringPointId: input.monitoringPointId,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.unit === undefined ? {} : { unit: input.unit }),
        ...(input.targetMin === undefined ? {} : { targetMin: input.targetMin }),
        ...(input.targetMax === undefined ? {} : { targetMax: input.targetMax }),
        ...(input.checkFrequency === undefined ? {} : { checkFrequency: input.checkFrequency }),
        ...(input.locationId === undefined ? {} : { locationId: input.locationId }),
        ...(input.storageAreaId === undefined ? {} : { storageAreaId: input.storageAreaId }),
        ...(input.active === undefined ? {} : { active: input.active }),
      });
      return row === undefined ? undefined : toMonitoringPoint(row);
    },
    listMonitoringPoints: async (query: MonitoringPointListQuery) => {
      const rows = await repo.listMonitoringPoints(db, {
        organizationId: query.organizationId,
        ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
        ...(query.activeOnly === undefined ? {} : { activeOnly: query.activeOnly }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toMonitoringPoint);
    },
    recordMonitoringReading: async (input) =>
      toMonitoringReading(await repo.recordMonitoringReading(db, newReadingValues(input))),
    listMonitoringReadings: async (query: MonitoringReadingListQuery) => {
      const rows = await repo.listMonitoringReadings(db, {
        organizationId: query.organizationId,
        ...(query.monitoringPointId === undefined
          ? {}
          : { monitoringPointId: query.monitoringPointId }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toMonitoringReading);
    },
    createIncident: async (input) =>
      toIncident(await repo.createIncident(db, newIncidentValues(input))),
    findIncident: async (query) => {
      const row = await repo.findIncident(db, {
        organizationId: query.organizationId,
        incidentId: query.incidentId,
      });
      return row === undefined ? undefined : toIncident(row);
    },
    updateIncident: async (input: UpdateIncidentRecord) => {
      const row = await repo.updateIncident(db, {
        organizationId: input.organizationId,
        incidentId: input.incidentId,
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.severity === undefined ? {} : { severity: input.severity }),
        ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
        ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.closedAt === undefined
          ? {}
          : { closedAt: input.closedAt === null ? null : new Date(input.closedAt) }),
        ...(input.updatedBy === undefined ? {} : { actorId: input.updatedBy }),
      });
      return row === undefined ? undefined : toIncident(row);
    },
    listIncidents: async (query: IncidentListQuery) => {
      const rows = await repo.listIncidents(db, {
        organizationId: query.organizationId,
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toIncident);
    },
    createCorrectiveAction: async (input) =>
      toCorrectiveAction(await repo.createCorrectiveAction(db, newCorrectiveActionValues(input))),
    findCorrectiveAction: async (query) => {
      const row = await repo.findCorrectiveAction(db, {
        organizationId: query.organizationId,
        correctiveActionId: query.correctiveActionId,
      });
      return row === undefined ? undefined : toCorrectiveAction(row);
    },
    updateCorrectiveAction: async (input: UpdateCorrectiveActionRecord) => {
      const row = await repo.updateCorrectiveAction(db, {
        organizationId: input.organizationId,
        correctiveActionId: input.correctiveActionId,
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
        ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
        ...(input.description === undefined ? {} : { description: input.description }),
        ...(input.completedAt === undefined ? {} : { completedAt: toDate(input.completedAt) }),
        ...(input.verifiedBy === undefined ? {} : { verifiedBy: input.verifiedBy }),
        ...(input.verifiedAt === undefined ? {} : { verifiedAt: toDate(input.verifiedAt) }),
        ...(input.updatedBy === undefined ? {} : { actorId: input.updatedBy }),
      });
      return row === undefined ? undefined : toCorrectiveAction(row);
    },
    listCorrectiveActions: async (query: CorrectiveActionListQuery) => {
      const rows = await repo.listCorrectiveActions(db, {
        organizationId: query.organizationId,
        ...(query.incidentId === undefined ? {} : { incidentId: query.incidentId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.ownerId === undefined ? {} : { ownerId: query.ownerId }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toCorrectiveAction);
    },
    createChecklistTemplate: async (input) =>
      toChecklistTemplate(
        await repo.createChecklistTemplate(db, newChecklistTemplateValues(input)),
      ),
    findChecklistTemplate: async (query) => {
      const row = await repo.findChecklistTemplate(db, {
        organizationId: query.organizationId,
        templateId: query.templateId,
      });
      return row === undefined ? undefined : toChecklistTemplate(row);
    },
    updateChecklistTemplate: async (input: UpdateChecklistTemplateRecord) => {
      const row = await repo.updateChecklistTemplate(db, {
        organizationId: input.organizationId,
        templateId: input.templateId,
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.category === undefined ? {} : { category: input.category }),
        ...(input.frequency === undefined ? {} : { frequency: input.frequency }),
        ...(input.items === undefined ? {} : { items: input.items }),
        ...(input.active === undefined ? {} : { active: input.active }),
        ...(input.updatedBy === undefined ? {} : { actorId: input.updatedBy }),
      });
      return row === undefined ? undefined : toChecklistTemplate(row);
    },
    listChecklistTemplates: async (query: ChecklistTemplateListQuery) => {
      const rows = await repo.listChecklistTemplates(db, {
        organizationId: query.organizationId,
        ...(query.category === undefined ? {} : { category: query.category }),
        ...(query.active === undefined ? {} : { active: query.active }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toChecklistTemplate);
    },
    createChecklistRun: async (input) =>
      toChecklistRun(await repo.createChecklistRun(db, newChecklistRunValues(input))),
    findChecklistRun: async (query) => {
      const row = await repo.findChecklistRun(db, {
        organizationId: query.organizationId,
        runId: query.runId,
      });
      return row === undefined ? undefined : toChecklistRun(row);
    },
    updateChecklistRun: async (input: UpdateChecklistRunRecord) => {
      const row = await repo.updateChecklistRun(db, {
        organizationId: input.organizationId,
        runId: input.runId,
        ...(input.status === undefined ? {} : { status: input.status }),
        ...(input.results === undefined ? {} : { results: input.results }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.updatedBy === undefined ? {} : { actorId: input.updatedBy }),
      });
      return row === undefined ? undefined : toChecklistRun(row);
    },
    listChecklistRuns: async (query: ChecklistRunListQuery) => {
      const rows = await repo.listChecklistRuns(db, {
        organizationId: query.organizationId,
        ...(query.templateId === undefined ? {} : { templateId: query.templateId }),
        ...(query.locationId === undefined ? {} : { locationId: query.locationId }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.limit === undefined ? {} : { limit: query.limit }),
        ...(query.offset === undefined ? {} : { offset: query.offset }),
      });
      return rows.map(toChecklistRun);
    },
  };
}
