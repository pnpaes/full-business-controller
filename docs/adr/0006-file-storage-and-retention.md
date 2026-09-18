# ADR-0006 — File storage and retention

- **Status:** Proposed (needs owner acceptance)
- This ADR is a proposal; implementation must not rely on it until status is `Accepted`.
- **Date:** 2026-09-13
- **Deciders:** TECH, BUS
- **Related:** `02:12`, `06:77`, `07:47-51`; SEC-002, OPS-003, DEC-014
- **Requirements:** SEC-002, SEC-003, OPS-003, OPS-005

## Context

The system stores invoices, recipe photos, import files, exports and evidence. Files must be private,
validated, checksummed, retention-governed and restorable (RPO 1 h) — and personal data must not leak
into logs or public URLs (`07:47`).

## Decision

Use **private S3-compatible object storage** in the same EU/EEA region as the database: **DigitalOcean
Spaces in the Amsterdam (AMS3) region** — **decided by DEC-014 (2026-09-14)**. Access is via
**short-lived server-generated signed URLs**; buckets are never public. Uploads validate
MIME/signature and size, malware-scan where available, and store a SHA-256 checksum (`06:77`).
Retention and deletion are per file class, recorded in `file_object.retention_policy`; deleting a file
never removes the financial/operational fact or its provenance (`03:128-133`).

## Alternatives considered

- AWS S3 `eu-north-1` — managed private buckets with signed URLs, but a separate provider from the
  accepted hosting platform; superseded by DigitalOcean Spaces per DEC-014.
- Cloudflare R2 EU — S3-compatible and cheap egress, but a separate provider from the accepted
  hosting platform; superseded by DigitalOcean Spaces per DEC-014.
- Store files in Postgres bytea — simple but poor for large/photo/import volumes and backups.
- Third-party DMS — unnecessary for MVP; revisit if e-signature/workflow needs emerge.

## Consequences

- Backups must cover the bucket as well as the database; restoration is tested before launch and
  quarterly (`07:61`, `09:78`).
- Signed URLs keep authorization server-side; exports within scope only (`07:19`).
- Retention policy must be decided with privacy review (DEC-012).

## Open items

- Provider and region are **decided by DEC-014 (2026-09-14): DigitalOcean Spaces, Amsterdam (AMS3)**.
- Approve retention periods per file class with the privacy review.
