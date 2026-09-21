/**
 * `DEC-080` (`DQ-001`): a `data_quality_exception` row as the transfers store
 * needs it. The port exposes only the create the receive command performs;
 * reads/updates live in the persistence repository. `timestamptz` columns are
 * ISO strings and `due_date` a `yyyy-mm-dd` string.
 */
export interface DataQualityExceptionRecord {
  readonly id: string;
  readonly organizationId: string;
  readonly ruleCode: string;
  readonly severity: string;
  readonly entityType: string;
  readonly entityId: string;
  /** `timestamptz`, ISO. */
  readonly detectedAt: string;
  readonly ownerId: string | null;
  /** `date`, `yyyy-mm-dd`. */
  readonly dueDate: string | null;
  readonly status: string;
  readonly resolution: string | null;
}

export interface NewDataQualityExceptionRecord {
  readonly organizationId: string;
  readonly ruleCode: string;
  readonly severity: string;
  readonly entityType: string;
  readonly entityId: string;
  /** `timestamptz`, ISO. */
  readonly detectedAt: string;
  readonly status: string;
  readonly resolution?: string | null;
  readonly ownerId?: string | null;
  /** `date`, `yyyy-mm-dd`. */
  readonly dueDate?: string | null;
  readonly createdBy?: string | null;
}

/**
 * The DEC-080 producer port: a store that can record a `data_quality_exception`
 * row inside its own transaction. Counts, production and transfers all extend it.
 */
export interface DataQualityExceptionStore {
  createDataQualityException(
    input: NewDataQualityExceptionRecord,
  ): Promise<DataQualityExceptionRecord>;
}
