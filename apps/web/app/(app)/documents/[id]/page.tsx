import {
  createPostgresDocumentsStore,
  createPostgresFileObjectsStore,
  findCurrentPublishedVersion,
  findDocument,
  findFileObject,
  listDocumentAcknowledgements,
  listDocumentVersions,
} from "@aquarela/application";
import {
  Alert,
  Badge,
  Breadcrumbs,
  DescriptionList,
  EmptyState,
  PageHeader,
  SectionCard,
  StatusPill,
  Table,
  Td,
  Th,
  color,
  spacing,
  typography,
} from "@aquarela/ui";
import { notFound, redirect } from "next/navigation";

import { getAuthStore } from "../../../../lib/auth";
import { getDb } from "../../../../lib/db";
import { resolveOrganization } from "../../../../lib/organization";
import { uuidOrNotFound } from "../../../../lib/route-params";
import { getServerSession } from "../../../../lib/server-session";
import {
  canManageDocuments,
  canReadDocument,
  loadDocumentAccess,
} from "../../../api/v1/documents/access";

import { AcknowledgeAction } from "../acknowledge-action";
import { CreateVersionForm } from "../create-version-form";
import { PublishVersionButton } from "../publish-version-button";
import {
  documentAudienceLabel,
  documentCategoryLabel,
  documentStatusView,
  formatDocumentInstant,
} from "../document-labels";

export const dynamic = "force-dynamic";

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

/**
 * Page-scoped responsive composition (brief §18): the version-history and
 * acknowledgement tables drop their notes/actor columns on phones; version,
 * state and date still identify each row.
 */
const pageCss = `
@media (max-width: 767px) {
  .doc-col-notes, .doc-col-actor { display: none; }
}
`;

/** A download affordance for a stored version file (`DEC-132`). */
const downloadLinkStyle = {
  color: color.ink.primary,
  fontWeight: typography.fontWeight.medium,
  textDecoration: "underline",
  textDecorationColor: color.border.strong,
  textUnderlineOffset: 3,
} as const;

/**
 * One document's detail page (`DEC-088`, `DOC-001`…`DOC-004`): the metadata,
 * the current published version, the acknowledgement state and action, and —
 * managers only — the version history, the acknowledgement register and the
 * version/publish actions.
 *
 * Reads the same application services and row shapes as
 * `GET /api/v1/documents/[id]`, `GET /api/v1/documents/[id]/versions` and
 * `GET /api/v1/documents/[id]/acknowledgements`, so the screen and the APIs
 * cannot drift. The per-document read gate (`DOC-001`) is mirrored from the
 * route: a non-manager may read only a **published** `all_staff` document —
 * anything else renders an explicit "not available" state (fail closed).
 * Mutations go through the existing API routes from client components; the
 * server remains the authority on every action.
 *
 * **File bytes are stored** (`DEC-132`): a manager can attach a file to a new
 * version, and a version that references a `file_object` shows a download link.
 * The download route applies the same read gate as this page, so a non-manager
 * can only download the current published `all_staff` version.
 */
export default async function DocumentPage({
  params,
}: {
  readonly params: Promise<{ readonly documentId: string }>;
}) {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const { documentId: rawId } = await params;
  const documentId = uuidOrNotFound(rawId);
  const organizationId = resolveOrganization();
  const store = createPostgresDocumentsStore(getDb().db);

  const document = await findDocument(store, { organizationId, documentId });
  if (document === undefined) {
    notFound();
  }

  const access = await loadDocumentAccess(session.userId);
  // Mirror the route's per-document gate (`DOC-001`): a non-manager may read
  // only a published `all_staff` document; fail closed otherwise.
  if (!canReadDocument(access, document)) {
    return (
      <div style={contentColumn}>
        <PageHeader title="Document" scope="Documents" />
        <EmptyState title="Not available for your role">
          This document is not published for all staff. Published, all-staff documents are open to
          everyone; drafts, archived documents and manager-audience documents are manager-only.
        </EmptyState>
      </div>
    );
  }

  const manager = canManageDocuments(access);
  const current = await findCurrentPublishedVersion(store, { organizationId, documentId });
  const myAcknowledgement =
    current === undefined
      ? undefined
      : await store.findDocumentAcknowledgement({
          organizationId,
          documentVersionId: current.id,
          acknowledgedBy: session.userId,
        });

  const versions = manager ? await listDocumentVersions(store, { organizationId, documentId }) : [];
  const latestVersion = versions.reduce<number | null>(
    (acc, version) => (acc === null || version.version > acc ? version.version : acc),
    null,
  );

  // Resolve the stored file metadata (`DEC-132`) for every displayed version
  // that references a `file_object`, so the page can name the file and link its
  // download; a version with no file stays "—".
  const filesStore = createPostgresFileObjectsStore(getDb().db);
  const fileObjectIds = [
    ...new Set(
      [current, ...versions].flatMap((version) =>
        version !== undefined && version.fileObjectId !== null ? [version.fileObjectId] : [],
      ),
    ),
  ];
  const fileObjects = await Promise.all(
    fileObjectIds.map((fileObjectId) =>
      findFileObject(filesStore, { organizationId, fileObjectId }),
    ),
  );
  const fileByObjectId = new Map(
    fileObjectIds.map((fileObjectId, index) => [fileObjectId, fileObjects[index]] as const),
  );

  const acknowledgements = manager
    ? await listDocumentAcknowledgements(store, { organizationId, documentId })
    : [];

  // Resolve actors to profile labels; never invent a name, so an unresolved id
  // falls back to the id itself (the app-shell convention).
  const actorIds = [
    ...new Set([
      ...versions.flatMap((version) => (version.publishedBy === null ? [] : [version.publishedBy])),
      ...acknowledgements.map((acknowledgement) => acknowledgement.acknowledgedBy),
    ]),
  ];
  const actors = await Promise.all(actorIds.map((id) => getAuthStore().findUserById(id)));
  const actorLabelById = new Map(
    actorIds.map((id, index) => {
      const actor = actors[index];
      return [id, actor === undefined ? id : (actor.email ?? actor.username ?? id)] as const;
    }),
  );

  const status = documentStatusView(document.status);

  return (
    <div style={contentColumn}>
      <style>{pageCss}</style>
      <Breadcrumbs
        items={[{ label: "Documents", href: "/documents" }, { label: document.title }]}
      />
      <PageHeader
        title={document.title}
        scope="Documents"
        description={`Versioned staff document · organization-wide (no location scope)`}
        actions={
          <>
            <StatusPill tone={status.tone}>{status.label}</StatusPill>
            <Badge>{documentAudienceLabel(document.audience)}</Badge>
          </>
        }
      />

      <Alert tone="info" title="Files are stored privately">
        A manager can attach a file to a new version; the bytes are stored privately (local storage,
        `DEC-132`) and streamed back only under the document read rule. Object storage, signed URLs
        and retention enforcement remain deferred (`DEC-132`, `ADR-0006`).
      </Alert>

      <SectionCard title="Details">
        <DescriptionList
          items={[
            { term: "Category", description: documentCategoryLabel(document.category) },
            { term: "Audience", description: documentAudienceLabel(document.audience) },
            { term: "Created", description: formatDocumentInstant(document.createdAt) },
            {
              term: "Last amended",
              description:
                document.updatedAt === null ? "—" : formatDocumentInstant(document.updatedAt),
            },
          ]}
        />
      </SectionCard>

      <SectionCard
        title="Current published version"
        meta={current === undefined ? "none" : `v${current.version}`}
      >
        {current === undefined ? (
          <EmptyState title="No published version">
            {manager
              ? "This document has no published version yet. Create a version below and publish it to make it visible to staff."
              : "This document has no published version yet — it becomes readable once a manager publishes one."}
          </EmptyState>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[4] }}>
            <DescriptionList
              items={[
                { term: "Version", description: `v${current.version}` },
                {
                  term: "Published",
                  description:
                    current.publishedAt === null ? "—" : formatDocumentInstant(current.publishedAt),
                },
                {
                  term: "File",
                  description:
                    current.fileObjectId === null ||
                    fileByObjectId.get(current.fileObjectId) === undefined ? (
                      "—"
                    ) : (
                      <a
                        href={`/api/v1/document-versions/${current.id}/file`}
                        style={downloadLinkStyle}
                      >
                        Download {fileByObjectId.get(current.fileObjectId)?.filename} (
                        {fileByObjectId
                          .get(current.fileObjectId)
                          ?.sizeBytes.toLocaleString("en-US")}{" "}
                        bytes)
                      </a>
                    ),
                },
                { term: "Notes", description: current.notes ?? "—" },
              ]}
            />
            {myAcknowledgement === undefined ? (
              <AcknowledgeAction documentId={document.id} />
            ) : (
              <Alert tone="success" title="Acknowledged">
                You acknowledged this version on{" "}
                {formatDocumentInstant(myAcknowledgement.acknowledgedAt)}. Acknowledgement is
                recorded per person per version.
              </Alert>
            )}
          </div>
        )}
      </SectionCard>

      {manager ? (
        <>
          <SectionCard
            title="Version history"
            meta={`${versions.length} ${versions.length === 1 ? "version" : "versions"} · manager view`}
          >
            {versions.length === 0 ? (
              <EmptyState title="No versions yet">
                Create the first version below; a document becomes readable only once a version is
                published.
              </EmptyState>
            ) : (
              <div style={{ overflowX: "auto", minWidth: 0 }}>
                <Table caption="All versions of this document, newest first" columnCount={6}>
                  <thead>
                    <tr>
                      <Th scope="col">Version</Th>
                      <Th scope="col">State</Th>
                      <Th scope="col" className="doc-col-notes">
                        Notes
                      </Th>
                      <Th scope="col">File</Th>
                      <Th scope="col">Published</Th>
                      <Th scope="col">Action</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {versions.map((version) => {
                      const published = version.publishedAt !== null;
                      const file =
                        version.fileObjectId === null
                          ? undefined
                          : fileByObjectId.get(version.fileObjectId);
                      return (
                        <tr key={version.id}>
                          <Td>v{version.version}</Td>
                          <Td>
                            <StatusPill tone={published ? "success" : "info"}>
                              {published ? "Published" : "Draft"}
                            </StatusPill>
                          </Td>
                          <Td className="doc-col-notes">{version.notes ?? "—"}</Td>
                          <Td>
                            {file === undefined ? (
                              "—"
                            ) : (
                              <a
                                href={`/api/v1/document-versions/${version.id}/file`}
                                style={downloadLinkStyle}
                              >
                                {file.filename}
                              </a>
                            )}
                          </Td>
                          <Td>
                            {published && version.publishedAt !== null
                              ? formatDocumentInstant(version.publishedAt)
                              : "—"}
                          </Td>
                          <Td>
                            {!published && version.version === latestVersion ? (
                              <PublishVersionButton documentVersionId={version.id} />
                            ) : (
                              "—"
                            )}
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              </div>
            )}
          </SectionCard>

          <SectionCard title="New version" meta="manager action">
            <CreateVersionForm documentId={document.id} />
          </SectionCard>

          <SectionCard
            title="Acknowledgements"
            meta={`${acknowledgements.length} ${
              acknowledgements.length === 1 ? "record" : "records"
            } · manager view`}
          >
            {acknowledgements.length === 0 ? (
              <EmptyState title="No acknowledgements yet">
                Staff acknowledgements of this document's published versions appear here as they are
                recorded. Acknowledgement is optional per document.
              </EmptyState>
            ) : (
              <Table caption="Who acknowledged which version of this document" columnCount={3}>
                <thead>
                  <tr>
                    <Th scope="col">Acknowledged by</Th>
                    <Th scope="col">Version</Th>
                    <Th scope="col">When</Th>
                  </tr>
                </thead>
                <tbody>
                  {acknowledgements.map((acknowledgement) => (
                    <tr key={acknowledgement.id}>
                      <Td className="doc-col-actor">
                        {actorLabelById.get(acknowledgement.acknowledgedBy) ??
                          acknowledgement.acknowledgedBy}
                      </Td>
                      <Td>
                        v
                        {versions.find(
                          (version) => version.id === acknowledgement.documentVersionId,
                        )?.version ?? acknowledgement.documentVersionId}
                      </Td>
                      <Td>{formatDocumentInstant(acknowledgement.acknowledgedAt)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </SectionCard>
        </>
      ) : null}
    </div>
  );
}
