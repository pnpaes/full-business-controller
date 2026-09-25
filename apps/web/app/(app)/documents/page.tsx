import {
  createPostgresDocumentsStore,
  DOCUMENT_CATEGORIES,
  findCurrentPublishedVersion,
  listDocuments,
} from "@aquarela/application";
import {
  Alert,
  Badge,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
  Table,
  Td,
  Th,
  color,
  geometry,
  radius,
  spacing,
  typography,
} from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getDb } from "../../../lib/db";
import { resolveOrganization } from "../../../lib/organization";
import { getServerSession } from "../../../lib/server-session";
import {
  canManageDocuments,
  DOCUMENT_READ_ROLES,
  isDocumentAuthorized,
  loadDocumentAccess,
} from "../../api/v1/documents/access";

import {
  documentAudienceLabel,
  documentCategoryLabel,
  documentStatusView,
  formatDocumentInstant,
} from "./document-labels";

export const dynamic = "force-dynamic";
export const metadata = { title: "Documents — Aquarela Business Control" };

/** The library shows a bounded working set; the read API pages beyond it. */
const LIBRARY_LIMIT = 100;

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

/**
 * Page-scoped responsive composition (brief §18) — the only styling inline
 * styles cannot express. The library table drops its audience and published
 * columns on phones; the remaining columns still identify the document.
 */
const pageCss = `
@media (max-width: 767px) {
  .doc-col-audience, .doc-col-published { display: none; }
}
`;

const titleLinkStyle = {
  color: color.ink.primary,
  fontWeight: typography.fontWeight.medium,
  textDecoration: "underline",
  textDecorationColor: color.border.strong,
  textUnderlineOffset: 3,
} as const;

const chipStyle = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: geometry.touchTarget,
  padding: `0 ${spacing[4]}px`,
  borderRadius: radius.pill,
  backgroundColor: color.surface.base,
  border: `1px solid ${color.border.default}`,
  color: color.ink.secondary,
  fontSize: typography.fontSize.md,
  textDecoration: "none",
} as const;

const chipActiveStyle = {
  ...chipStyle,
  backgroundColor: color.accent.soft,
  borderColor: color.accent.deep,
  color: color.ink.primary,
  boxShadow: `inset 0 0 0 1px ${color.accent.deep}`,
} as const;

/**
 * The staff document library (`DEC-088`, `DOC-001`): published documents by
 * category with their current published version and its publish date.
 *
 * Reads the same application services and row shapes as
 * `GET /api/v1/documents`, so the screen and the API cannot drift. Access is
 * the document read role set (`../../api/v1/documents/access.ts`); a caller
 * outside it gets an explicit "not available" state. The per-document
 * `all_staff` + `published` gate (`DOC-001`) is mirrored from the route: a
 * non-manager's query is forced to `published` + `all_staff` server-side, a
 * manager sees every document and status. The library is organization-wide —
 * there is no location scope (`DEC-088`).
 *
 * **File bytes are stored** (`DEC-132`): a manager attaches a file when
 * creating a version, and the version detail page links its download. Object
 * storage, signed URLs and retention enforcement remain deferred (`ADR-0006`).
 */
export default async function DocumentsPage({
  searchParams,
}: {
  readonly searchParams: Promise<{ readonly category?: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadDocumentAccess(session.userId);
  if (!isDocumentAuthorized(access, DOCUMENT_READ_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader
          title="Documents"
          scope="Documents"
          description="The staff document library: routines, guidelines, policies and forms."
        />
        <EmptyState title="Not available for your role">
          The document library is open to every staff role. Your account currently holds no
          recognized role — ask an owner or administrator to check your role assignment.
        </EmptyState>
      </div>
    );
  }

  const manager = canManageDocuments(access);
  const { category: rawCategory } = await searchParams;
  // An unknown category filter is treated as absent (the API would 400 a
  // vocabulary miss; a page quietly ignoring it keeps a bad link harmless).
  const category =
    rawCategory !== undefined && DOCUMENT_CATEGORIES.includes(rawCategory)
      ? rawCategory
      : undefined;

  const organizationId = resolveOrganization();
  const store = createPostgresDocumentsStore(getDb().db);
  const documents = await listDocuments(store, {
    organizationId,
    ...(category === undefined ? {} : { category }),
    // Mirror the route's per-role narrowing (`DOC-001`): a non-manager may only
    // see published `all_staff` documents, narrowed server-side.
    ...(manager ? {} : { status: "published", audience: "all_staff" }),
    limit: LIBRARY_LIMIT,
  });

  const currentVersions = await Promise.all(
    documents.map((document) =>
      findCurrentPublishedVersion(store, { organizationId, documentId: document.id }),
    ),
  );

  return (
    <div style={contentColumn}>
      <style>{pageCss}</style>
      <PageHeader
        title="Documents"
        scope="Documents"
        description="The staff document library: routines, guidelines, policies and forms, versioned and published by managers."
        actions={
          manager ? (
            <a href="/documents/new" style={chipStyle}>
              New document
            </a>
          ) : null
        }
      />

      <Alert tone="info" title="Files are versioned and stored privately">
        A manager can attach a file when creating a version; the bytes are stored privately and
        downloaded under the document read rule (`DEC-132`). Object storage, signed URLs and
        retention enforcement remain deferred (`DEC-132`, `ADR-0006`).
      </Alert>

      <nav
        aria-label="Filter by category"
        style={{ display: "flex", flexWrap: "wrap", gap: spacing[2] }}
      >
        <a
          href="/documents"
          style={category === undefined ? chipActiveStyle : chipStyle}
          aria-current={category === undefined ? "page" : undefined}
        >
          All categories
        </a>
        {DOCUMENT_CATEGORIES.map((value) => (
          <a
            key={value}
            href={`/documents?category=${value}`}
            style={category === value ? chipActiveStyle : chipStyle}
            aria-current={category === value ? "page" : undefined}
          >
            {documentCategoryLabel(value)}
          </a>
        ))}
      </nav>

      <SectionCard
        title="Library"
        meta={`${documents.length} ${documents.length === 1 ? "document" : "documents"}${
          manager ? "" : " · published for all staff"
        }`}
      >
        {documents.length === 0 ? (
          <EmptyState title="No documents">
            {manager
              ? "No documents match this view yet. Create one with “New document”, then version and publish it."
              : "Nothing has been published for all staff in this category yet. Check back later or ask a manager."}
          </EmptyState>
        ) : (
          <div style={{ overflowX: "auto", minWidth: 0 }}>
            <Table caption="Staff documents with their current published version" columnCount={6}>
              <thead>
                <tr>
                  <Th scope="col">Title</Th>
                  <Th scope="col">Category</Th>
                  <Th scope="col" className="doc-col-audience">
                    Audience
                  </Th>
                  <Th scope="col">Status</Th>
                  <Th scope="col">Current version</Th>
                  <Th scope="col" className="doc-col-published">
                    Published
                  </Th>
                </tr>
              </thead>
              <tbody>
                {documents.map((document, index) => {
                  const current = currentVersions[index];
                  const status = documentStatusView(document.status);
                  return (
                    <tr key={document.id}>
                      <Td>
                        <a href={`/documents/${document.id}`} style={titleLinkStyle}>
                          {document.title}
                        </a>
                      </Td>
                      <Td>{documentCategoryLabel(document.category)}</Td>
                      <Td className="doc-col-audience">
                        <Badge>{documentAudienceLabel(document.audience)}</Badge>
                      </Td>
                      <Td>
                        <StatusPill tone={status.tone}>{status.label}</StatusPill>
                      </Td>
                      <Td>{current === undefined ? "—" : `v${current.version}`}</Td>
                      <Td className="doc-col-published">
                        {current?.publishedAt === undefined || current?.publishedAt === null
                          ? "—"
                          : formatDocumentInstant(current.publishedAt)}
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
