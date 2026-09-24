import { DOCUMENT_AUDIENCES, DOCUMENT_CATEGORIES } from "@aquarela/application";
import { EmptyState, PageHeader, SectionCard, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getServerSession } from "../../../../lib/server-session";
import {
  DOCUMENT_MANAGE_ROLES,
  isDocumentAuthorized,
  loadDocumentAccess,
} from "../../../api/v1/documents/access";

import { documentAudienceLabel, documentCategoryLabel } from "../document-labels";
import { CreateDocumentForm } from "../create-document-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "New document — Aquarela Business Control" };

const contentColumn = {
  display: "flex",
  flexDirection: "column",
  gap: spacing[6],
  width: "100%",
  maxWidth: 1120,
  margin: "0 auto",
  padding: `${spacing[8]}px ${spacing[4]}px`,
} as const;

/**
 * The create-document screen (`DEC-088`, `DOC-001`) — a managed action
 * (`DOCUMENT_MANAGE_ROLES`, `DEC-088`/`DEC-100`). Posts through the existing
 * `POST /api/v1/documents` route from the client form; the access check here
 * mirrors the route's, and the server remains the authority.
 */
export default async function NewDocumentPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }

  const access = await loadDocumentAccess(session.userId);
  if (!isDocumentAuthorized(access, DOCUMENT_MANAGE_ROLES)) {
    return (
      <div style={contentColumn}>
        <PageHeader title="New document" scope="Documents" />
        <EmptyState title="Not available for your role">
          Creating a document is limited to managers (owner, general manager, location manager and
          admin). Ask one to create the document, or an owner to extend your role.
        </EmptyState>
      </div>
    );
  }

  return (
    <div style={contentColumn}>
      <PageHeader
        title="New document"
        scope="Documents"
        description="Create a staff document. It starts as a draft; version and publish it from its page."
      />
      <SectionCard title="Document details" meta="draft · no file attached">
        <CreateDocumentForm
          categories={DOCUMENT_CATEGORIES.map((value) => ({
            value,
            label: documentCategoryLabel(value),
          }))}
          audiences={DOCUMENT_AUDIENCES.map((value) => ({
            value,
            label: documentAudienceLabel(value),
          }))}
        />
      </SectionCard>
    </div>
  );
}
