/**
 * Audit action vocabulary for the file-storage slice (`DEC-132`). Values are
 * the `audit_event.action` strings; keeping them here stops a handler from
 * drifting into near-duplicate names. A `file_object` row is the one audited
 * fact (its bytes are not auditable content), entity type `file_object`.
 */
export const FILE_AUDIT_ACTIONS = {
  fileObjectCreated: "files.file_object.created",
} as const;
