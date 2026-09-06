# ADR-0001 — Pinned toolchain versions

**Status:** Accepted
**Date:** 2026-09-05
**Supersedes:** the version numbers in `docs/MIGRATION_BLUEPRINT.md` §04 / §09

## Context

The blueprint specifies "Next.js 14 (App Router)" and Tailwind/Prisma without
versions. It was drafted before this repo existed, and the ecosystem has moved
several majors since. Starting an 8–10 month rewrite on a deliberately old major
means paying an upgrade tax mid-project, on top of the migration itself.

Registry state at the time of writing:

| Package | npm `latest` | Chosen | Why |
|---|---|---|---|
| `next` | 16.3.4 | **16.3.4** | App Router is mature here; blueprint's "14" was a snapshot, not a requirement. |
| `react` / `react-dom` | 19.2.8 | **19.2.8** | Required by Next 16 (`peerDependencies: ^19.0.0`). |
| `@nestjs/*` | 12.x | **12.x** | Current major. Needs Node >= 20. |
| `typescript` | 7.0.2 | **6.0.3** | See below — this is the non-obvious one. |
| `prisma` / `@prisma/client` | 8.0.0-rc.13 | **7.10.0** | `latest` is a release candidate. `prev` tag is 7.10.0 stable. |
| `tailwindcss` | 4.3.3 | **4.3.3** | v4 is CSS-first; no `tailwind.config.js`. Affects how §04's "tokens carried over" is implemented. |
| `motion` | 13.2.0 | **13.2.0** | `framer-motion` renamed to `motion`. Blueprint's "Framer Motion" means this package. |
| Node | — | **>= 20.9** | Intersection of Next 16 (`>=20.9.0`) and NestJS 12 (`>= 20`). Dev machine runs 24.13. |

## Decision

### TypeScript 6, not 7

npm's `latest` is TypeScript 7. We pin **6.0.3** anyway, because `@nestjs/cli@12`
itself depends on `typescript: ~6.0.2`.

This matters more than a normal version skew. NestJS dependency injection is built
on decorators and `emitDecoratorMetadata` — the exact area TypeScript 7 changes. If
metadata emit differs even subtly, the failure mode is not a compile error; it is
providers resolving to `undefined` at runtime, in a service graph we are
simultaneously porting from Java. Debugging that while also trying to establish
whether a port is faithful is the worst possible place to spend a week.

One TypeScript version across the whole workspace, matching what the framework's own
CLI ships. Revisit when NestJS declares TS 7 support.

### Prisma 7, not 8

`prisma@latest` currently resolves to `8.0.0-rc.13`. The blueprint makes Prisma
load-bearing: the schema is introspected from the existing 50-migration Flyway
database (`prisma db pull`), and that introspection result is the contract the whole
API port is written against. An RC introspector producing a slightly different schema
than a later stable one would invalidate work downstream of it.

Pin `7.10.0` (the `prev` dist-tag, i.e. last stable). Upgrade deliberately, after
phase 0's introspection output has been reviewed and committed.

### Tailwind 4 changes how §04 is satisfied

The blueprint says the existing 60 CSS custom properties carry over into Tailwind.
Under Tailwind 4 that is done via `@theme` in CSS rather than a `tailwind.config.js`
`theme.extend`. This is *more* aligned with the blueprint's intent — the existing app
already uses custom properties for its light/dark/system theming, so the tokens stay
CSS variables end to end instead of being translated into JS config and back.

## Consequences

- The blueprint's stack tables are updated to match; this ADR is the reason.
- Everything is pinned to an exact version, not a range. A rewrite that must decrypt
  existing production vault data is not the place for floating dependencies.
- Two follow-ups are now tracked, not forgotten: TypeScript 7 once NestJS supports
  it, Prisma 8 once it ships stable and phase 0's schema is locked.
- Node >= 20.9 becomes a documented requirement for CI images and Dockerfiles.
