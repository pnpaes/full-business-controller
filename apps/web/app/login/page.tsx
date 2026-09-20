import { Card, WatercolorBackdrop, color, spacing, typography } from "@aquarela/ui";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Aquarela Business Control" };

const fontDisplay = { fontFamily: typography.fontFamily.display } as const;
const fontSans = { fontFamily: typography.fontFamily.sans } as const;

export default function LoginPage() {
  return (
    <main
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        padding: `${spacing[16]}px ${spacing[4]}px`,
      }}
    >
      <WatercolorBackdrop />
      <div style={{ position: "relative", width: "100%", maxWidth: 420 }}>
        <Card elevation="floating">
          <div style={{ display: "flex", flexDirection: "column", gap: spacing[6] }}>
            <header style={{ display: "flex", flexDirection: "column", gap: spacing[2] }}>
              <span
                style={{
                  ...fontDisplay,
                  fontSize: typography.fontSize.sm,
                  fontWeight: typography.fontWeight.semibold,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: color.brand.berry,
                }}
              >
                Aquarela Business Control
              </span>
              <h1
                style={{
                  ...fontDisplay,
                  margin: 0,
                  fontSize: typography.fontSize["3xl"],
                  fontWeight: typography.fontWeight.semibold,
                  lineHeight: typography.lineHeight.tight,
                  color: color.brand.navy,
                }}
              >
                Sign in
              </h1>
            </header>
            <LoginForm />
          </div>
        </Card>
        <p
          style={{
            ...fontSans,
            margin: `${spacing[4]}px 0 0`,
            textAlign: "center",
            fontSize: typography.fontSize.sm,
            color: color.text.muted,
          }}
        >
          Costs, stock and sales in one place.
        </p>
      </div>
    </main>
  );
}
