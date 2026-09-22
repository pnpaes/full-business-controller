import { isAuthorizedFor, loadUserAccess, type UserAccess } from "@aquarela/application";
import type { DocumentRecord } from "@aquarela/application";

import { getAuthStore } from "../../../../lib/auth";

/**
 * Role sets for the staff document library (`DEC-088`, requirements
 * `DOC-001`…`DOC-004`), drawn from the `07_SECURITY_AND_NFR.md` access matrix
 * row "Staff document library (published)".
 *
 * This mirrors the workforce access module (`../workforce/access.ts`) rather than
 * importing it: the role sets differ (everyone reads a published `all_staff`
 * document) and the document slices are a distinct domain. The single
 * authorization primitive (`isAuthorizedFor`, no implicit admin bypass) is still
 * shared through `@aquarela/application`. The access module is named for the
 * `documents` routes; the version routes under `../document-versions/` import
 * these same helpers.
 */

/**
 * Reading the register: everyone reads (`07_SECURITY_AND_NFR.md`, row "Staff
 * document library (published)" — "All staff: read published documents"). The
 * narrower rule — a non-manager may only read a **published** document whose
 * audience is `all_staff` — is enforced per document by
 * {@link canReadDocument}, not by the role list. `admin` is listed explicitly
 * (no implicit bypass).
 */
export const DOCUMENT_READ_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "kitchen",
  "front_of_house",
  "purchasing",
  "finance",
  "admin",
  "analyst",
] as const;

/**
 * Managing the library — creating a document, amending it, creating/publishing a
 * version and reading superseded versions or the acknowledgement register —
 * is `owner` / `general_manager` / `location_manager` / `admin` (`DEC-088`,
 * `DOC-002`). `admin` is an explicit grant, not a bypass.
 */
export const DOCUMENT_MANAGE_ROLES = [
  "owner",
  "general_manager",
  "location_manager",
  "admin",
] as const;

/** Loads the caller's roles and location scope live from server data (ADR-0003). */
export async function loadDocumentAccess(userId: string): Promise<UserAccess> {
  return loadUserAccess(getAuthStore(), userId);
}

/**
 * True when `access` holds one of `roles`. A pure role check — `document` has no
 * location column, so no location scope is applied (unlike the HMS/workforce
 * employee routes). A missing/empty role list fails closed.
 */
export function isDocumentAuthorized(access: UserAccess, roles: readonly string[]): boolean {
  return roles.some((role) => isAuthorizedFor(access, { role }));
}

/** True when the caller may publish/version/archive and read superseded versions. */
export function canManageDocuments(access: UserAccess): boolean {
  return isDocumentAuthorized(access, DOCUMENT_MANAGE_ROLES);
}

/**
 * The per-document read gate (`DOC-001`): a manager may read any document; a
 * non-manager may read only a document that is **published** and whose audience
 * is **`all_staff`**. A draft, an archived document or a `managers`-audience
 * document is invisible to a non-manager (403 at the route).
 */
export function canReadDocument(
  access: UserAccess,
  document: Pick<DocumentRecord, "status" | "audience">,
): boolean {
  return (
    canManageDocuments(access) ||
    (document.status === "published" && document.audience === "all_staff")
  );
}
