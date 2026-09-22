/**
 * Staff document library version helpers (`DEC-088`, `DOC-002`).
 *
 * A document version carries a manual, per-document `version_no` counter
 * (`unique (document_id, version_no)`) and is published by stamping
 * `published_at`/`published_by` together. This helper is pure: it takes the
 * already-loaded versions and answers which number the next version should carry.
 * It imports nothing — no persistence, no clock.
 *
 * Note the current *published* version is resolved in persistence
 * (`findCurrentPublishedVersion`), not here, so the read is org-scoped and does
 * not depend on the caller loading (and ordering) every version.
 */

/**
 * The next `version_no` for a document: the greatest existing version plus one,
 * or `1` when the document has no versions yet.
 */
export function nextDocumentVersionNumber(
  versions: readonly { readonly version: number }[],
): number {
  let greatest = 0;
  for (const version of versions) {
    if (version.version > greatest) greatest = version.version;
  }
  return greatest + 1;
}
