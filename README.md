# Ai-Stack-change — OrgPortal on Next.js + NestJS

Full rewrite of **My Promon / OrgPortal** from Laravel 11 (Blade) + Spring Boot 3.2
(Java) onto **Next.js 14 + NestJS + Prisma**, in TypeScript end to end.

The plan of record is [`docs/MIGRATION_BLUEPRINT.md`](docs/MIGRATION_BLUEPRINT.md).
Read that first — it defines the 10 phases, the module inventory, and the
non-negotiable security invariants.

## Why this repo exists

The existing portal is two cleanly separated services: a Blade frontend that renders
and relays, and a Spring Boot backend that owns every business rule. The API contract
between them is already the seam, which makes a staged rewrite viable — the database
schema and the zero-knowledge vault crypto both carry over **unchanged**.

## Hard constraints

These are not preferences. They come from the existing app's security posture and are
tracked in [`docs/phase-0/security-baseline.md`](docs/phase-0/security-baseline.md).

1. **Zero-knowledge vault.** The server never sees, logs, or validates vault
   plaintext. All vault crypto stays client-side on the native Web Crypto API.
2. **Crypto parameters are frozen.** Argon2id / AES-256-GCM / RSA-OAEP-3072 port
   byte-for-byte so existing production vault data decrypts without re-encryption.
3. **The OAuth2 opaque single-use code exchange is reproduced exactly.** The JWT
   never appears in a redirect URL, browser history, or referrer.
4. **AI is architecturally isolated from vault data.** Enforced by service/route
   separation and tests, not convention.
5. **The backend is the authorization boundary.** Frontend route gates are UX
   convenience only; every rule is re-checked server-side.
6. **Database schema is introspected, never hand-modelled.** Flyway's migrations in
   the old backend remain the source of truth for schema shape.

## Layout

```
apps/
  web/     Next.js 14 (App Router) — React 18, TypeScript, Tailwind
  api/     NestJS — modules/controllers/providers, Prisma
packages/
  crypto/  Ported zero-knowledge vault crypto (framework-agnostic TypeScript)
docs/
  MIGRATION_BLUEPRINT.md   The plan
  phase-0/                 Grounded audits of the source systems
```

## Status

| Phase | State |
|---|---|
| 0 · Discovery & parity baseline | in progress |
| 1 · Platform foundation | not started |
| 2 · Password Manager & Policy Management | not started |
| 3 · Core operations | not started |
| 4 · Resource & time modules | not started |
| 5 · Admin & Settings | not started |
| 6 · Interview & Assessment | not started |
| 7 · Analytics, reporting, AI agent | not started |
| 8 · Security hardening & regression | not started |
| 9 · Parallel run & cutover | not started |

## Source systems

Audited, not vendored:

- `OrgPortalFrontend` — Laravel 11 / Blade / vanilla JS
- `OrgPortalBackend` — Spring Boot 3.2 / Java 17 / Flyway / PostgreSQL
