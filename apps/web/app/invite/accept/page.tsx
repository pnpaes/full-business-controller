import { color, spacing } from "@aquarela/ui";

import { InviteAcceptForm } from "./invite-accept-form";

export const metadata = { title: "Accept invite — Aquarela Business Control" };

/**
 * The public invite-acceptance page (`DEC-146`, `WF-003`). The invite email
 * links here **without** a token (`ADR-0003`); the employee types or pastes the
 * code from the message. No session is required and none is read.
 */
export default function InviteAcceptPage() {
  return (
    <main
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        padding: `${spacing[16]}px ${spacing[4]}px`,
      }}
    >
      <div style={{ width: "100%", maxWidth: 420 }}>
        <h1
          style={{
            margin: `0 0 ${spacing[1]}px`,
            fontSize: 30,
            fontWeight: 600,
            color: color.brand.navy,
          }}
        >
          Accept invite
        </h1>
        <p style={{ margin: `0 0 ${spacing[6]}px`, color: color.text.secondary }}>
          Enter the invite code from your email and choose a password. This sets up your account so
          you can sign in and see your shifts.
        </p>
        <InviteAcceptForm />
      </div>
    </main>
  );
}
