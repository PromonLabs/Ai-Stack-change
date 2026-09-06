# Ai-Stack-change — OrgPortal on Next.js + NestJS

Full rewrite of **My Promon / OrgPortal** from Laravel 11 (Blade) + Spring Boot 3.2
(Java) onto **Next.js + NestJS + Prisma**, in TypeScript end to end. Exact pinned
versions are in [`docs/adr/0001-toolchain-versions.md`](docs/adr/0001-toolchain-versions.md)
(Next.js 16.3.4, React 19.2.8, NestJS 12, TypeScript 6.0.3, Prisma 7.10.0, Tailwind 4.3.3).

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
  web/     Next.js (App Router) — React, TypeScript, Tailwind v4. App shell scaffolded.
  api/     NestJS — modules/controllers/providers. Skeleton + health check scaffolded;
           Prisma schema is intentionally a datasource/generator stub (see prisma/schema.prisma)
           until it can be introspected from a real database — never hand-modelled.
packages/
  crypto/  Ported zero-knowledge vault crypto (framework-agnostic TypeScript) — not yet
           scaffolded, planned for phase 2.
docs/
  MIGRATION_BLUEPRINT.md   The plan
  phase-0/                 Grounded audits of the source systems (frontend-audit.md,
                           backend-audit.md, security-baseline.md)
```

## Getting started

```
npm install
npm run dev:web    # Next.js dev server
npm run dev:api    # NestJS dev server (needs apps/api/.env — copy from .env.example)
```

Both apps currently only expose a health check (`GET /` on web, `GET /api/health` on
both web and api) — there is no auth, no database wiring, and no UI beyond a
placeholder page yet. See `docs/MIGRATION_BLUEPRINT.md` §06 (Phase 1) for what's next.

## Status

| Phase | State |
|---|---|
| 0 · Discovery & parity baseline | in progress — frontend + backend audits and security baseline done; still open: Entra ID app registration details, a staging DB snapshot for Prisma introspection, sign-off that `UI_MODERNIZATION_PLAN.md` is superseded |
| 1 · Platform foundation | in progress — app shell (`apps/web`) and API skeleton (`apps/api`) scaffolded with health checks; auth, RBAC, design system, and DB wiring not started |
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
