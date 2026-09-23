import { color, typography, uiGlobalCss } from "@aquarela/ui";
import { Manrope } from "next/font/google";
import type { Metadata } from "next";
import type { ReactNode } from "react";

/** The brief's geometric/humanist sans (§4), exposed as `--font-sans` so the
 * token layer's `sansVar` stack resolves; falls back to the system stack when
 * the variable is absent. */
const sans = Manrope({ subsets: ["latin"], display: "swap", variable: "--font-sans" });

export const metadata: Metadata = {
  title: "Aquarela Business Control",
  description: "Internal business control system for Aquarela.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={sans.variable}>
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
