import { color, spacing } from "@aquarela/ui";

import { ResetCompleteForm } from "./reset-complete-form";

export const metadata = { title: "Complete password reset — Aquarela Business Control" };

export default function ResetCompletePage() {
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
          Complete reset
        </h1>
        <p style={{ margin: `0 0 ${spacing[6]}px`, color: color.text.secondary }}>
          Enter the reset code you received and choose a new password.
        </p>
        <ResetCompleteForm />
      </div>
    </main>
  );
}
