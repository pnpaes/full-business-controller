import { color, spacing } from "@aquarela/ui";

import { ResetBeginForm } from "./reset-begin-form";

export const metadata = { title: "Reset password — Aquarela Business Control" };

export default function ResetPage() {
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
          Reset password
        </h1>
        <p style={{ margin: `0 0 ${spacing[6]}px`, color: color.text.secondary }}>
          We will send reset instructions if the account exists.
        </p>
        <ResetBeginForm />
      </div>
    </main>
  );
}
