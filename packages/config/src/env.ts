import { z } from "zod";

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((value) => /^postgres(ql)?:\/\//.test(value), {
      message: "must be a postgres:// or postgresql:// connection string",
    }),
  // Bounded so a misconfiguration cannot create 694-day sessions or reset
  // windows; 1440 minutes (24 h) is well above any operational need.
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(480),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(30),
  // Base64 32-byte key sealing TOTP secrets at rest (AES-256). Optional here so
  // worker and scheduler boot without it; the length is enforced at config load
  // so a wrong-size key fails fast instead of at the first MFA operation.
  TOTP_SECRET_ENCRYPTION_KEY: z
    .string()
    .min(1)
    .refine((value) => Buffer.from(value, "base64").length === 32, {
      message: "must be a base64-encoded 32-byte key",
    })
    .optional(),
  // Outbound password-reset delivery via SendGrid (`DEC-147`). All optional and
  // secret-free here: without them the reset stays admin-issued and the adapter
  // fails closed. `SENDGRID_API_KEY` is a secret supplied at deploy; `MAIL_FROM`
  // is the verified sender; `APP_BASE_URL` is the public origin used to build
  // the reset-page link (no token is ever placed in a URL, `ADR-0003`).
  SENDGRID_API_KEY: z.string().min(1).optional(),
  MAIL_FROM: z.string().min(1).optional(),
  APP_BASE_URL: z.string().url().optional(),
});

export type AppConfig = Readonly<z.infer<typeof envSchema>>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    // Only field paths and issue codes are surfaced: values (which may contain credentials)
    // are never included in the error message.
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.code}`)
      .join("; ");
    throw new ConfigError(`invalid environment configuration: ${issues}`);
  }
  return Object.freeze(parsed.data);
}
