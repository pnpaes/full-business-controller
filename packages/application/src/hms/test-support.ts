import type { AuditInput } from "../auth";

import type {
  ChecklistRunListQuery,
  ChecklistRunRecord,
  ChecklistTemplateListQuery,
  ChecklistTemplateRecord,
  CorrectiveActionListQuery,
  CorrectiveActionRecord,
  EquipmentListQuery,
  EquipmentRecord,
  HmsStore,
  IncidentListQuery,
  IncidentRecord,
  MaintenanceLogListQuery,
  MaintenanceLogRecord,
  MonitoringPointListQuery,
  MonitoringPointRecord,
  MonitoringReadingListQuery,
  MonitoringReadingRecord,
  NewChecklistRunRecord,
  NewChecklistTemplateRecord,
  NewCorrectiveActionRecord,
  NewEquipmentRecord,
  NewIncidentRecord,
  NewMaintenanceLogRecord,
  NewMonitoringPointRecord,
  NewMonitoringReadingRecord,
  UpdateChecklistRunRecord,
  UpdateChecklistTemplateRecord,
  UpdateCorrectiveActionRecord,
  UpdateEquipmentRecord,
  UpdateIncidentRecord,
  UpdateMonitoringPointRecord,
} from "./types";

/**
 * A shallow copy of every mutable map/array an HMS transaction can touch, used
 * to roll back a failed `withTransaction` (the fake runs inline without one).
 */
interface HmsSnapshot {
  readonly monitoringPoints: Map<string, MonitoringPointRecord>;
  readonly monitoringReadings: Map<string, MonitoringReadingRecord>;
  readonly incidents: Map<string, IncidentRecord>;
  readonly correctiveActions: Map<string, CorrectiveActionRecord>;
  readonly checklistTemplates: Map<string, ChecklistTemplateRecord>;
  readonly checklistRuns: Map<string, ChecklistRunRecord>;
  readonly equipment: Map<string, EquipmentRecord>;
  readonly maintenanceLogs: Map<string, MaintenanceLogRecord>;
  readonly audits: AuditInput[];
}

/**
 * In-memory `HmsStore` for the unit suite. It mirrors the Postgres adapter's
 * organization scoping, ordering and paging so the commands and queries can be
 * exercised without a database; `hms.postgres.test.ts` covers the real adapter.
 */
export class FakeHmsStore implements HmsStore {
  readonly monitoringPoints = new Map<string, MonitoringPointRecord>();
  readonly monitoringReadings = new Map<string, MonitoringReadingRecord>();
  readonly incidents = new Map<string, IncidentRecord>();
  readonly correctiveActions = new Map<string, CorrectiveActionRecord>();
  readonly checklistTemplates = new Map<string, ChecklistTemplateRecord>();
  readonly checklistRuns = new Map<string, ChecklistRunRecord>();
  readonly equipment = new Map<string, EquipmentRecord>();
  readonly maintenanceLogs = new Map<string, MaintenanceLogRecord>();
  readonly audits: AuditInput[] = [];

  private sequence = 0;

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${this.sequence}`;
  }

  async withTransaction<T>(fn: (store: HmsStore) => Promise<T>): Promise<T> {
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

  private snapshot(): HmsSnapshot {
    return {
      monitoringPoints: new Map(this.monitoringPoints),
      monitoringReadings: new Map(this.monitoringReadings),
      incidents: new Map(this.incidents),
      correctiveActions: new Map(this.correctiveActions),
      checklistTemplates: new Map(this.checklistTemplates),
      checklistRuns: new Map(this.checklistRuns),
      equipment: new Map(this.equipment),
      maintenanceLogs: new Map(this.maintenanceLogs),
      audits: [...this.audits],
    };
  }

  private restore(snapshot: HmsSnapshot): void {
    this.monitoringPoints.clear();
    for (const [key, value] of snapshot.monitoringPoints) this.monitoringPoints.set(key, value);
    this.monitoringReadings.clear();
    for (const [key, value] of snapshot.monitoringReadings) {
      this.monitoringReadings.set(key, value);
    }
    this.incidents.clear();
    for (const [key, value] of snapshot.incidents) this.incidents.set(key, value);
    this.correctiveActions.clear();
    for (const [key, value] of snapshot.correctiveActions) {
      this.correctiveActions.set(key, value);
    }
    this.checklistTemplates.clear();
    for (const [key, value] of snapshot.checklistTemplates) {
      this.checklistTemplates.set(key, value);
    }
    this.checklistRuns.clear();
    for (const [key, value] of snapshot.checklistRuns) this.checklistRuns.set(key, value);
    this.equipment.clear();
    for (const [key, value] of snapshot.equipment) this.equipment.set(key, value);
    this.maintenanceLogs.clear();
    for (const [key, value] of snapshot.maintenanceLogs) this.maintenanceLogs.set(key, value);
    this.audits.length = 0;
    this.audits.push(...snapshot.audits);
  }

  async writeAudit(input: AuditInput): Promise<void> {
    this.audits.push(input);
  }

  async createMonitoringPoint(input: NewMonitoringPointRecord): Promise<MonitoringPointRecord> {
    const record: MonitoringPointRecord = {
      id: this.nextId("point"),
      ...input,
      active: true,
      createdAt: new Date().toISOString(),
    };
    this.monitoringPoints.set(record.id, record);
    return record;
  }

  async findMonitoringPoint(query: {
    readonly organizationId: string;
    readonly monitoringPointId: string;
  }): Promise<MonitoringPointRecord | undefined> {
    const point = this.monitoringPoints.get(query.monitoringPointId);
    return point !== undefined && point.organizationId === query.organizationId ? point : undefined;
  }

  async updateMonitoringPoint(
    input: UpdateMonitoringPointRecord,
  ): Promise<MonitoringPointRecord | undefined> {
    const existing = await this.findMonitoringPoint({
      organizationId: input.organizationId,
      monitoringPointId: input.monitoringPointId,
    });
    if (existing === undefined) return undefined;
    // Replace the record rather than mutate it: the transaction snapshot keeps
    // the old object reference, so an in-place edit would survive a rollback.
    const record: MonitoringPointRecord = {
      ...existing,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.unit === undefined ? {} : { unit: input.unit }),
      ...(input.targetMin === undefined ? {} : { targetMin: input.targetMin }),
      ...(input.targetMax === undefined ? {} : { targetMax: input.targetMax }),
      ...(input.checkFrequency === undefined ? {} : { checkFrequency: input.checkFrequency }),
      ...(input.locationId === undefined ? {} : { locationId: input.locationId }),
      ...(input.storageAreaId === undefined ? {} : { storageAreaId: input.storageAreaId }),
      ...(input.active === undefined ? {} : { active: input.active }),
    };
    this.monitoringPoints.set(record.id, record);
    return record;
  }

  async listMonitoringPoints(
    query: MonitoringPointListQuery,
  ): Promise<readonly MonitoringPointRecord[]> {
    const rows = [...this.monitoringPoints.values()]
      .filter((point) => point.organizationId === query.organizationId)
      .filter((point) => query.locationId === undefined || point.locationId === query.locationId)
      .filter((point) => query.activeOnly !== true || point.active)
      .sort((a, b) => {
        if (a.code !== b.code) return a.code < b.code ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async recordMonitoringReading(
    input: NewMonitoringReadingRecord,
  ): Promise<MonitoringReadingRecord> {
    const record: MonitoringReadingRecord = {
      id: this.nextId("reading"),
      ...input,
      // Match the adapter's `toMonitoringReading`, which reads the `timestamptz`
      // back as `Date(...).toISOString()`.
      measuredAt: new Date(input.measuredAt).toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.monitoringReadings.set(record.id, record);
    return record;
  }

  async listMonitoringReadings(
    query: MonitoringReadingListQuery,
  ): Promise<readonly MonitoringReadingRecord[]> {
    const rows = [...this.monitoringReadings.values()]
      .filter((reading) => reading.organizationId === query.organizationId)
      .filter(
        (reading) =>
          query.monitoringPointId === undefined ||
          reading.monitoringPointId === query.monitoringPointId,
      )
      .sort((a, b) => {
        if (a.measuredAt !== b.measuredAt) return a.measuredAt < b.measuredAt ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async createIncident(input: NewIncidentRecord): Promise<IncidentRecord> {
    const record: IncidentRecord = {
      id: this.nextId("incident"),
      ...input,
      // A new incident starts `open` with no close instant, like the adapter;
      // `createdBy` comes from the input and no update has run yet.
      closedAt: null,
      createdAt: new Date().toISOString(),
      updatedBy: null,
    };
    this.incidents.set(record.id, record);
    return record;
  }

  async findIncident(query: {
    readonly organizationId: string;
    readonly incidentId: string;
  }): Promise<IncidentRecord | undefined> {
    const incident = this.incidents.get(query.incidentId);
    return incident !== undefined && incident.organizationId === query.organizationId
      ? incident
      : undefined;
  }

  async updateIncident(input: UpdateIncidentRecord): Promise<IncidentRecord | undefined> {
    const existing = await this.findIncident({
      organizationId: input.organizationId,
      incidentId: input.incidentId,
    });
    if (existing === undefined) return undefined;
    // Replace the record rather than mutate it: the transaction snapshot keeps
    // the old object reference, so an in-place edit would survive a rollback.
    const record: IncidentRecord = {
      ...existing,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.severity === undefined ? {} : { severity: input.severity }),
      ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
      ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
      ...(input.title === undefined ? {} : { title: input.title }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.closedAt === undefined
        ? {}
        : { closedAt: input.closedAt === null ? null : new Date(input.closedAt).toISOString() }),
      ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy }),
    };
    this.incidents.set(record.id, record);
    return record;
  }

  async listIncidents(query: IncidentListQuery): Promise<readonly IncidentRecord[]> {
    const rows = [...this.incidents.values()]
      .filter((incident) => incident.organizationId === query.organizationId)
      .filter((incident) => query.status === undefined || incident.status === query.status)
      .filter(
        (incident) => query.locationId === undefined || incident.locationId === query.locationId,
      )
      .sort((a, b) => {
        if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async createCorrectiveAction(input: NewCorrectiveActionRecord): Promise<CorrectiveActionRecord> {
    const record: CorrectiveActionRecord = {
      id: this.nextId("action"),
      ...input,
      // A new action starts `open`, so the derived companions are all null;
      // `createdBy` comes from the input and no update has run yet.
      completedAt: null,
      verifiedBy: null,
      verifiedAt: null,
      createdAt: new Date().toISOString(),
      updatedBy: null,
    };
    this.correctiveActions.set(record.id, record);
    return record;
  }

  async findCorrectiveAction(query: {
    readonly organizationId: string;
    readonly correctiveActionId: string;
  }): Promise<CorrectiveActionRecord | undefined> {
    const action = this.correctiveActions.get(query.correctiveActionId);
    return action !== undefined && action.organizationId === query.organizationId
      ? action
      : undefined;
  }

  async updateCorrectiveAction(
    input: UpdateCorrectiveActionRecord,
  ): Promise<CorrectiveActionRecord | undefined> {
    const existing = await this.findCorrectiveAction({
      organizationId: input.organizationId,
      correctiveActionId: input.correctiveActionId,
    });
    if (existing === undefined) return undefined;
    const record: CorrectiveActionRecord = {
      ...existing,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
      ...(input.dueDate === undefined ? {} : { dueDate: input.dueDate }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.completedAt === undefined
        ? {}
        : {
            completedAt:
              input.completedAt === null ? null : new Date(input.completedAt).toISOString(),
          }),
      ...(input.verifiedBy === undefined ? {} : { verifiedBy: input.verifiedBy }),
      ...(input.verifiedAt === undefined
        ? {}
        : {
            verifiedAt: input.verifiedAt === null ? null : new Date(input.verifiedAt).toISOString(),
          }),
      ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy }),
    };
    this.correctiveActions.set(record.id, record);
    return record;
  }

  async listCorrectiveActions(
    query: CorrectiveActionListQuery,
  ): Promise<readonly CorrectiveActionRecord[]> {
    const rows = [...this.correctiveActions.values()]
      .filter((action) => action.organizationId === query.organizationId)
      .filter((action) => query.incidentId === undefined || action.incidentId === query.incidentId)
      .filter((action) => query.status === undefined || action.status === query.status)
      .filter((action) => query.ownerId === undefined || action.ownerId === query.ownerId)
      .sort((a, b) => {
        // `due_date` ascending, a null due date last (the adapter's `asc` with
        // Postgres's default NULLS LAST), then `id` ascending.
        const aDue = a.dueDate ?? "\uffff";
        const bDue = b.dueDate ?? "\uffff";
        if (aDue !== bDue) return aDue < bDue ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async createChecklistTemplate(
    input: NewChecklistTemplateRecord,
  ): Promise<ChecklistTemplateRecord> {
    const record: ChecklistTemplateRecord = {
      id: this.nextId("template"),
      ...input,
      createdAt: new Date().toISOString(),
      updatedBy: null,
    };
    this.checklistTemplates.set(record.id, record);
    return record;
  }

  async findChecklistTemplate(query: {
    readonly organizationId: string;
    readonly templateId: string;
  }): Promise<ChecklistTemplateRecord | undefined> {
    const template = this.checklistTemplates.get(query.templateId);
    return template !== undefined && template.organizationId === query.organizationId
      ? template
      : undefined;
  }

  async updateChecklistTemplate(
    input: UpdateChecklistTemplateRecord,
  ): Promise<ChecklistTemplateRecord | undefined> {
    const existing = await this.findChecklistTemplate({
      organizationId: input.organizationId,
      templateId: input.templateId,
    });
    if (existing === undefined) return undefined;
    // Replace the record rather than mutate it: the transaction snapshot keeps
    // the old object reference, so an in-place edit would survive a rollback.
    const record: ChecklistTemplateRecord = {
      ...existing,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.category === undefined ? {} : { category: input.category }),
      ...(input.frequency === undefined ? {} : { frequency: input.frequency }),
      ...(input.items === undefined ? {} : { items: input.items }),
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy }),
    };
    this.checklistTemplates.set(record.id, record);
    return record;
  }

  async listChecklistTemplates(
    query: ChecklistTemplateListQuery,
  ): Promise<readonly ChecklistTemplateRecord[]> {
    const rows = [...this.checklistTemplates.values()]
      .filter((template) => template.organizationId === query.organizationId)
      .filter((template) => query.category === undefined || template.category === query.category)
      .filter((template) => query.active === undefined || template.active === query.active)
      .sort((a, b) => {
        if (a.name !== b.name) return a.name < b.name ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async createChecklistRun(input: NewChecklistRunRecord): Promise<ChecklistRunRecord> {
    const record: ChecklistRunRecord = {
      id: this.nextId("run"),
      ...input,
      // Match the adapter's `toChecklistRun`, which reads the `timestamptz` back
      // as `Date(...).toISOString()`.
      runAt: new Date(input.runAt).toISOString(),
      createdAt: new Date().toISOString(),
      updatedBy: null,
    };
    this.checklistRuns.set(record.id, record);
    return record;
  }

  async findChecklistRun(query: {
    readonly organizationId: string;
    readonly runId: string;
  }): Promise<ChecklistRunRecord | undefined> {
    const run = this.checklistRuns.get(query.runId);
    return run !== undefined && run.organizationId === query.organizationId ? run : undefined;
  }

  async updateChecklistRun(
    input: UpdateChecklistRunRecord,
  ): Promise<ChecklistRunRecord | undefined> {
    const existing = await this.findChecklistRun({
      organizationId: input.organizationId,
      runId: input.runId,
    });
    if (existing === undefined) return undefined;
    const record: ChecklistRunRecord = {
      ...existing,
      ...(input.status === undefined ? {} : { status: input.status }),
      ...(input.results === undefined ? {} : { results: input.results }),
      ...(input.notes === undefined ? {} : { notes: input.notes }),
      ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy }),
    };
    this.checklistRuns.set(record.id, record);
    return record;
  }

  async listChecklistRuns(query: ChecklistRunListQuery): Promise<readonly ChecklistRunRecord[]> {
    const rows = [...this.checklistRuns.values()]
      .filter((run) => run.organizationId === query.organizationId)
      .filter((run) => query.templateId === undefined || run.templateId === query.templateId)
      .filter((run) => query.locationId === undefined || run.locationId === query.locationId)
      .filter((run) => query.status === undefined || run.status === query.status)
      .sort((a, b) => {
        // Newest `run_at` first, then `id` descending (the adapter's `desc`).
        if (a.runAt !== b.runAt) return a.runAt < b.runAt ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async createEquipment(input: NewEquipmentRecord): Promise<EquipmentRecord> {
    const record: EquipmentRecord = {
      id: this.nextId("equipment"),
      ...input,
      createdAt: new Date().toISOString(),
      updatedBy: null,
    };
    this.equipment.set(record.id, record);
    return record;
  }

  async findEquipment(query: {
    readonly organizationId: string;
    readonly equipmentId: string;
  }): Promise<EquipmentRecord | undefined> {
    const row = this.equipment.get(query.equipmentId);
    return row !== undefined && row.organizationId === query.organizationId ? row : undefined;
  }

  async updateEquipment(input: UpdateEquipmentRecord): Promise<EquipmentRecord | undefined> {
    const existing = await this.findEquipment({
      organizationId: input.organizationId,
      equipmentId: input.equipmentId,
    });
    if (existing === undefined) return undefined;
    // Replace the record rather than mutate it: the transaction snapshot keeps
    // the old object reference, so an in-place edit would survive a rollback.
    const record: EquipmentRecord = {
      ...existing,
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.kind === undefined ? {} : { kind: input.kind }),
      ...(input.serialNo === undefined ? {} : { serialNo: input.serialNo }),
      ...(input.installedAt === undefined ? {} : { installedAt: input.installedAt }),
      ...(input.warrantyUntil === undefined ? {} : { warrantyUntil: input.warrantyUntil }),
      ...(input.active === undefined ? {} : { active: input.active }),
      ...(input.updatedBy === undefined ? {} : { updatedBy: input.updatedBy }),
    };
    this.equipment.set(record.id, record);
    return record;
  }

  async listEquipment(query: EquipmentListQuery): Promise<readonly EquipmentRecord[]> {
    const rows = [...this.equipment.values()]
      .filter((row) => row.organizationId === query.organizationId)
      .filter((row) => query.locationId === undefined || row.locationId === query.locationId)
      .filter((row) => query.kind === undefined || row.kind === query.kind)
      .filter((row) => query.active === undefined || row.active === query.active)
      .sort((a, b) => {
        if (a.code !== b.code) return a.code < b.code ? -1 : 1;
        return a.id < b.id ? -1 : 1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }

  async createMaintenanceLog(input: NewMaintenanceLogRecord): Promise<MaintenanceLogRecord> {
    const record: MaintenanceLogRecord = {
      id: this.nextId("maintenance-log"),
      ...input,
      // Match the adapter's `toMaintenanceLog`, which reads the `timestamptz`
      // back as `Date(...).toISOString()`.
      performedAt: new Date(input.performedAt).toISOString(),
      createdAt: new Date().toISOString(),
    };
    this.maintenanceLogs.set(record.id, record);
    return record;
  }

  async findMaintenanceLog(query: {
    readonly organizationId: string;
    readonly maintenanceLogId: string;
  }): Promise<MaintenanceLogRecord | undefined> {
    const row = this.maintenanceLogs.get(query.maintenanceLogId);
    return row !== undefined && row.organizationId === query.organizationId ? row : undefined;
  }

  async listMaintenanceLogs(
    query: MaintenanceLogListQuery,
  ): Promise<readonly MaintenanceLogRecord[]> {
    const rows = [...this.maintenanceLogs.values()]
      .filter((row) => row.organizationId === query.organizationId)
      .filter((row) => query.equipmentId === undefined || row.equipmentId === query.equipmentId)
      .filter((row) => query.kind === undefined || row.kind === query.kind)
      .sort((a, b) => {
        // Newest `performed_at` first, then `id` descending (the adapter's `desc`).
        if (a.performedAt !== b.performedAt) return a.performedAt < b.performedAt ? 1 : -1;
        return a.id < b.id ? 1 : -1;
      });
    const offset = query.offset ?? 0;
    const limit = query.limit ?? rows.length;
    return rows.slice(offset, offset + limit);
  }
}

export interface HmsFixture {
  readonly organizationId: string;
  readonly otherOrganizationId: string;
  readonly actorId: string;
  readonly locationId: string;
  readonly otherLocationId: string;
  /** A second actor, e.g. the verifier of a corrective action. */
  readonly ownerId: string;
}

/**
 * Seeds the two-organization fixture the HMS tests share: a location in each
 * organization so a point can be registered in one and read from the other, plus
 * a second actor for the owner/verifier fields.
 */
export function seedHmsFixture(): HmsFixture {
  return {
    organizationId: "org-1",
    otherOrganizationId: "org-2",
    actorId: "actor-1",
    locationId: "loc-1",
    otherLocationId: "loc-2",
    ownerId: "actor-2",
  };
}
