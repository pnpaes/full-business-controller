/**
 * The single generic login/recovery failure message (ADR-0003, "Generic login
 * errors"). Application handlers import it instead of retyping the string, so
 * the response cannot drift and leak which part of a credential was wrong.
 */
export const AUTH_ERROR_GENERIC = "Invalid email or password" as const;
