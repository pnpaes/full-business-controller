import { PageHeader, spacing } from "@aquarela/ui";
import { redirect } from "next/navigation";

import { getAuthStore } from "../../../lib/auth";
import { getServerSession } from "../../../lib/server-session";

import { MfaSecurityPanel } from "./mfa-security";

export const dynamic = "force-dynamic";
export const metadata = { title: "Account security — Aquarela Business Control" };

/**
 * Server component: the session is resolved server-side (never from a client
 * claim) and an unauthenticated visitor is redirected before any panel renders.
 * The interactive enrolment/disable flow is the only client component.
 */
export default async function AccountSecurityPage() {
  const session = await getServerSession();
  if (session === undefined) {
    redirect("/login");
  }
  const user = await getAuthStore().findUserById(session.userId);
  if (user === undefined) {
    redirect("/login");
  }

  return (
    <main
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: `${spacing[12]}px ${spacing[4]}px`,
      }}
    >
      <div style={{ width: "100%", maxWidth: 720 }}>
        <PageHeader
          title="Account security"
          scope="Aquarela Business Control"
          description="Two-factor authentication (authenticator app / TOTP) for your account."
        />
        <MfaSecurityPanel mfaEnabled={user.totpEnabled} />
      </div>
    </main>
  );
}
