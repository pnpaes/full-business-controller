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
  SESSION_TTL_MINUTES: z.coerce.number().int().positive().default(480),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().positive().default(30),
  // Base64 32-byte key sealing TOTP secrets at rest. Optional here so worker and
  // scheduler boot without it; auth MFA operations fail loudly when it is absent.
  TOTP_SECRET_ENCRYPTION_KEY: z.string().min(1).optional(),
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
