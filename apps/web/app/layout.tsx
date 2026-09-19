import { color, typography, uiGlobalCss } from "@aquarela/ui";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Aquarela Business Control",
  description: "Internal business control system for Aquarela.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          backgroundColor: color.background.page,
          color: color.text.primary,
          fontFamily: typography.fontFamily.sans,
        }}
      >
        <style dangerouslySetInnerHTML={{ __html: uiGlobalCss }} />
        {children}
      </body>
    </html>
  );
}
