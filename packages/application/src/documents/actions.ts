/**
 * Audit action vocabulary for the staff document library slice (`DEC-088`,
 * `DOC-001`…`DOC-004`). Values are the `audit_event.action` strings; keeping
 * them here stops a handler from drifting into near-duplicate names.
 *
 * Publishing records its own action rather than overloading the document
 * `updated`, because publication is a version-level fact; acknowledgement is a
 * fact of its own. Entity types are `document`, `document_version` and
 * `document_acknowledgement`.
 */
export const DOCUMENT_AUDIT_ACTIONS = {
  documentCreated: "documents.document.created",
  documentUpdated: "documents.document.updated",
  documentVersionCreated: "documents.document_version.created",
  documentVersionPublished: "documents.document_version.published",
  documentAcknowledgementCreated: "documents.document_acknowledgement.created",
} as const;
