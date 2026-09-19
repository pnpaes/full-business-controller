import { color, spacing } from "@aquarela/ui";

import { LoginForm } from "./login-form";

export const metadata = { title: "Sign in — Aquarela Business Control" };

export default function LoginPage() {
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
          Sign in
        </h1>
        <p style={{ margin: `0 0 ${spacing[6]}px`, color: color.text.secondary }}>
          Aquarela Business Control
        </p>
        <LoginForm />
      </div>
    </main>
  );
}
