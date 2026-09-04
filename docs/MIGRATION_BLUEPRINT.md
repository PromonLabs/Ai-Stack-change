# OrgPortal Stack Migration — Blueprint

**Migration Blueprint · My Promon / OrgPortal**

Full rewrite: Laravel 11/Blade + Spring Boot 3.2 (Java) → React (Next.js) + Node.js.
All 13 portal modules, plus the zero-knowledge Password Manager & Policy Management
module, with a modern animation layer throughout.

| | |
|---|---|
| **Prepared** | 05 Sep 2026 |
| **Source** | `OrgPortalFrontend` + `OrgPortalBackend` (both now under review — see `phase-0/`) |
| **Target repo** | `PromonLabs/Ai-Stack-change` |
| **Status** | Phase 0 in progress |

---

## 01 · Reconciling with the existing modernization plan

> **Conflict on record**
>
> The frontend repo already contains `UI_MODERNIZATION_PLAN.md` (last reviewed
> 31 Jul 2026), which audits the same 41 Blade templates this document covers and
> explicitly concludes: *"No React, Vue, Bootstrap, Tailwind, Vite, npm, or
> application JavaScript bundle"* — modernize in place, keep Blade, plain CSS,
> vanilla JS.
>
> This document does the opposite: replace Blade and Spring Boot outright. That's a
> deliberate reversal, per direction, not an oversight — but whoever approved the
> July plan should know it's being superseded before phase 1 work starts, since some
> of that plan's phase-1/phase-2 foundation work (design tokens, focus states,
> reduced-motion support) is worth carrying forward into the new stack rather than
> doing twice.

## 02 · Current architecture

Two services, cleanly separated — this pattern (frontend renders + relays, backend
owns every rule) is actually the biggest asset going into a rewrite, since the API
contract is already the seam.

| Layer | Technology | Notes |
|---|---|---|
| Frontend | Laravel 11 (PHP 8.2), Blade | No bundler, no npm. Vanilla JS modules served directly from `public/`. |
| Frontend → Backend | Guzzle over HTTPS, JWT bearer | Frontend validates input *shape* only; every business rule lives in the backend. |
| Backend | Spring Boot 3.2.3, Java 17 (Java 21 JRE) | Controller → Service → Repository. |
| Auth | Spring Security, stateless JWT + Microsoft Entra ID OAuth2 | Login redirect issues a short-lived, single-use opaque code; frontend exchanges it server-to-server for the real JWT — the raw token never touches a redirect URL. |
| Database | PostgreSQL, schema owned by Flyway (50 versioned migrations) | Frontend has zero direct DB access — no Eloquent models for domain data. |
| Password vault crypto | Client-side only — Argon2id (hash-wasm) + AES-256-GCM + RSA-OAEP-3072 via native Web Crypto API | Neither backend ever sees a plaintext secret. See §05. |
| External integrations | Microsoft Graph (mail, org photo sync), external Seat-Booking service, "Service 2" OAuth2 proxy, Claude/OpenRouter (AI copilot) | All backend-side. |

## 03 · Module inventory — full scope

Everything below is in scope. **Password Manager & Policy Management** is the
flagship module — highest-security surface in the app, and the one place where the
current implementation already does something genuinely advanced (zero-knowledge
crypto) that a rewrite must not regress.

| Class | Module | Scope |
|---|---|---|
| **Flagship** | **Password Manager & Policy Mgmt** | Vault, folders, favorites/archive/bin, key mgmt, generator, groups, sharing, share links, TOTP MFA, audit log, policy CRUD + acknowledgment |
| Core | Dashboard | Role-aware landing page, charts, drag/drop Kanban board |
| Core | Tickets & Approvals | Full lifecycle, SLA deadlines, multi-level approval chain, comments/mentions, watchers, relationships |
| Core | Calendar | Compliance/review calendar, recurring access-review events |
| Reporting | Analytics & Reports | Trend charts, SLA breach analysis, domain workload, PDF/export |
| Ops | Hour Tracking | Daily logging, project/category hierarchy, team roll-up, PDF export |
| Ops | Seat & Room Booking | Visual seat/room maps, conflict-free reservations — the only area Guests can reach |
| Admin | User Management | CRUD, roles, manager assignment, activation |
| Admin | Groups | Named user groups for assignment/notification targeting |
| Admin | Documents | Batch upload, per-user assignment, read/view tracking |
| Admin | Org Chart & Photo Sync | Reporting hierarchy, Microsoft Graph photo sync |
| Admin | Settings | Roles, Domains, Projects & Categories, SLA timing |
| Assessment | Interview & Assessment | Recruiter question sets, timed MCQ/coding tests, public token-based candidate flow, sandboxed code execution, anti-cheat telemetry |
| Utility | Profile & Notifications | Profile, password change, theme preference, notification bell |
| Utility | AI Agent & DB Bot | In-app AI assistant — must stay strictly isolated from vault data, see §08 |

## 04 · Target architecture

| Layer | Current | Target |
|---|---|---|
| Frontend framework | Laravel Blade (server-rendered PHP) | Next.js 14 (App Router), React 18, TypeScript |
| Backend framework | Spring Boot 3.2 (Controller/Service/Repository) | NestJS — the closest structural analog: modules, controllers, providers, DI |
| Data access | Spring Data JPA / Hibernate | Prisma, schema **introspected from the existing PostgreSQL database** (`prisma db pull`) — Flyway's 50 migrations stay the source of truth for schema shape; don't re-model by hand |
| Auth | Spring Security, stateless JWT + Entra ID OAuth2 | Custom NestJS JWT module replicating the same claims/expiry, MSAL (`@azure/msal-node`) for the Entra ID flow — **the opaque single-use code exchange pattern must be reproduced exactly**, not simplified |
| Vault/policy crypto | Vanilla JS, native Web Crypto API | **Unchanged.** Ports into a TypeScript module almost verbatim — see §05 |
| Styling | Handwritten CSS, 60 custom properties, no framework | Tailwind CSS, tokens carried over from the existing palette (teal identity, light/dark/system theme already works — keep it) |
| State | Session-scoped Blade view data | React Query (server state) + Zustand (UI state) |
| Animation | None — CSS transitions only | Framer Motion (UI/layout), GSAP (sequenced/scroll), see §07 |
| Charts | Chart.js 4.4.3 | Recharts / visx with animated transitions |
| PDF export | `barryvdh/laravel-dompdf` | Puppeteer or `@react-pdf/renderer` |
| Code sandbox (Interview) | Backend-side code-runner (Java) | Reimplemented with the same isolation guarantees — containerized/VM-sandboxed execution, not a bare `eval`/`child_process`. Dedicated security review item. |
| Deployment | Docker (nginx + PHP-FPM), separate JVM container | Docker, single Node runtime for API, Next.js on Vercel or self-hosted — existing GitHub Actions (`ci.yaml`, `cd-staging.yaml`, `cd-prod.yaml`) adapted, not rebuilt |

## 05 · The vault crypto question — better news than it looks

> **`vault-crypto.js` is already framework-agnostic**
>
> The entire zero-knowledge layer — Argon2id key derivation (via hash-wasm),
> AES-256-GCM encrypt/wrap, RSA-OAEP-3072 for sharing — runs entirely on the
> browser's native `window.crypto.subtle` API. It has no dependency on Blade, PHP,
> or jQuery. It's already, functionally, a portable TypeScript module wearing a
> 2015-era IIFE wrapper.
>
> That means the highest-risk part of a typical "rewrite the password manager"
> project — re-deriving a compatible crypto implementation in a new stack — mostly
> isn't a risk here. Phase 2 lifts this file close to verbatim (convert `var`/IIFE
> to TS modules, keep every algorithm parameter — Argon2id
> `{parallelism:1, iterations:3, memorySize:65536}`, AES-256-GCM, RSA-OAEP-3072 /
> SHA-256 — byte-for-byte identical) so every vault item encrypted under the current
> app decrypts correctly under the new one, with **zero re-encryption migration
> required**.
>
> What *does* need care: the NestJS side of the vault endpoints (`/api/vault/*`,
> `/api/password-entries`, `/api/vault-groups`, `/api/vault-share-links`) must relay
> these opaque fields exactly as today — same field names, same "never touch, never
> log, never validate as if it were plaintext" discipline the current
> `PasswordManagerController.php` comments are explicit about.

## 06 · Migration phases

Password Manager & Policy Management goes second, right after the platform
foundation — it's self-contained enough to prove the new stack end-to-end, and
getting the crypto/auth foundation right here de-risks every module that follows.

### Phase 0 — Discovery & parity baseline · ~2–3 weeks
- Get read access to `OrgPortalBackend` — Flyway migrations, `application.properties`, service layer.
- Run `prisma db pull` against a staging copy of the Postgres database to generate the real schema — don't hand-model 50 migrations' worth of tables.
- Capture the exact Microsoft Entra ID app registration config (client ID, redirect URI, tenant, Graph scopes) so the new OAuth2 flow is a drop-in replacement, not a new app registration.
- Inventory `routes/web.php` against the new route map 1:1 before any UI work starts.

**Deliverable:** backend audit doc + Prisma schema + route inventory

### Phase 1 — Platform foundation · ~4–5 weeks
- Next.js app shell: layout, sidebar/topbar (role-aware nav conditionals ported from `layouts/app.blade.php`), the existing light/dark/system theme system rebuilt on the same CSS-custom-property approach.
- NestJS API skeleton, Prisma client wired to the pulled schema.
- Auth end-to-end: Entra ID OAuth2 including the opaque single-use code exchange, JWT issuance/refresh, the seeded email/password fallback path.
- RBAC middleware equivalent to `JwtAuth` / `AdminOnly` / `GuestAccess` — Next.js middleware for the frontend UX gate, NestJS guards for the real authorization boundary.
- Design system + animation primitives (Framer Motion wrapper components, motion tokens) that every later phase reuses — built once here, not per-module.

**Deliverable:** login → authenticated shell, working end-to-end

### Phase 2 — Password Manager & Policy Management · ~5–6 weeks
- Port `vault-crypto.js` to TypeScript per §05 — same algorithms, same parameters, unit-tested against known encrypt/decrypt vectors from the current app.
- Rebuild vault UI: list/folders/favorites/archive/bin, key management (SSH keys), generator, item modal with reveal/copy/history.
- Vault Groups + sharing + identity-bound share links, TOTP MFA setup/verify/disable, admin audit log.
- Policy Management: CRUD, document upload/viewer, per-user acknowledgment tracking.
- NestJS vault/policy endpoints as thin, zero-knowledge-preserving relays — no field renames, no accidental logging of ciphertext-adjacent fields.

**Deliverable:** full password manager, existing vault data decrypts correctly

### Phase 3 — Core operations · ~5–6 weeks
- Dashboard incl. drag/drop Kanban board (per-user board-config layout).
- Tickets: full lifecycle, SLA countdown, multi-level approval chain, comments/mentions/watchers/relationships/reminders/attachments.
- Approvals queue, compliance Calendar.

**Deliverable:** ticket lifecycle at parity, including approval routing

### Phase 4 — Resource & time modules · ~3–4 weeks
- Seat & Room Booking — interactive maps, conflict checking, Guest-role restriction.
- Hour Tracking — daily logging, team roll-up, PDF export.

### Phase 5 — Admin & Settings · ~3–4 weeks
- User management, Groups, Documents (upload + read-tracking), Org Chart + Photo Sync.
- Settings hub: Roles, Domains, Projects & Categories, SLA timing.

### Phase 6 — Interview & Assessment · ~4–5 weeks
- Recruiter tooling: question sets, bulk upload, timed test creation.
- Public candidate flow: token-validated entry, MCQ + coding tests, anti-cheat telemetry.
- Sandboxed code execution — its own security design review (containerized execution, resource limits, no filesystem/network escape), since this is the one module that runs untrusted user-submitted code.

**Deliverable:** signed-off sandbox security review before this phase closes

### Phase 7 — Analytics, reporting, AI agent · ~3–4 weeks
- Analytics/Reports with animated Recharts/visx charts, export/PDF.
- Notifications, Profile.
- AI Agent / DB Bot — rebuilt with an explicit, enforced isolation boundary from vault data (§08).

### Phase 8 — Security hardening & full regression · ~3–4 weeks
- Run the existing `Password Manager Application.txt` test prompt already in the repo — a genuinely thorough security/QA script (auth, encryption, session, IDOR, clipboard; skip Electron-specific items since this is a web app) — against the new build as the literal acceptance test.
- OWASP ASVS pass on auth, RBAC, and the interview code sandbox specifically.
- Independent penetration test before cutover.

### Phase 9 — Parallel run & cutover · ~2–3 weeks
- New stack validated against the same production database in a staging window (schema unchanged means this is safe — no dual-write).
- Staged rollout by team/role, instant rollback path to Laravel + Spring Boot retained until a full policy/SLA cycle has run clean.
- Decommission Laravel + Spring Boot; retire `UI_MODERNIZATION_PLAN.md` as superseded (§01).

## 07 · Animation layer

Built into the platform foundation (phase 1) as reusable primitives, then applied
per module — not bolted on at the end.

| Surface | Current behavior | Animated treatment |
|---|---|---|
| Kanban board (`board-ui.js`) | Instant DOM reflow on drag/drop | Framer Motion `layout` animations — cards fluidly reflow, drop targets highlight on hover |
| SLA countdown (`sla-countdown.js`) | Static text, color swap at thresholds | Animated progress ring with color interpolation as a ticket approaches breach |
| Toasts (`toast.js`) | CSS fade | Spring-based slide-in/out, stacking, swipe-to-dismiss |
| Theme toggle | Instant swap | Smooth cross-fade of color tokens on the existing 3-state cycle — keep the no-flash-of-wrong-theme guarantee |
| Org chart | Static tree | Animated pan/zoom, expand/collapse of reporting branches |
| Seat/room maps | Static SVG/grid | Animated selection state, hover previews, booked/available transitions |
| Vault reveal/copy | Instant show, manual copy | Animated mask-to-reveal, copy confirmation, and a visible auto-clear countdown on the clipboard |
| Analytics charts | Chart.js, static render | Recharts/visx with animated value transitions on filter change, staggered bar/line reveal |
| Approval chain | Text list of approval levels | Animated stepper showing the multi-level chain (T1 Lead → Domain Lead → Manager → CEO) with live status |
| Interview timer | Static countdown text | Animated progress bar with urgency color shift near time-out |

Every animation respects `prefers-reduced-motion`; none of them is the only channel
for state that matters (SLA breach, selection, approval status always have a
text/icon fallback too).

## 08 · Security parity

> **Non-negotiable before cutover**
>
> **Zero-knowledge guarantee** — carried forward unchanged per §05. The new NestJS
> backend must be held to the same rule the current Java/PHP code already documents
> in comments: it never sees, logs, or validates vault plaintext.
>
> **OAuth2 opaque-code exchange** — the two-minute, single-use code pattern that
> keeps the JWT out of browser history/referrers must be reproduced exactly, not
> "simplified" by putting the token in a redirect.
>
> **AI isolation boundary** — no vault data, master password, or encryption key may
> ever reach the AI Agent/DB Bot module or any external AI service. This needs to be
> an enforced architectural boundary in the new stack (separate service/route
> scope), not just a convention.
>
> **RBAC parity across seven roles** — Admin, Manager, Domain Lead, T1 Lead, User,
> Guest, Recruiter — including the specific rule that Guest is restricted to Seat
> Booking only, and that frontend route gates are UX convenience while the backend
> is the real authorization boundary (this dual-layer pattern should be kept, not
> collapsed into frontend-only checks).
>
> **Interview code sandbox** — the one module executing untrusted, user-submitted
> code. Needs its own isolation review in the new stack regardless of how the current
> Java implementation does it.

> **Reuse what's already there**
>
> `Password Manager Application.txt` is a complete, well-structured security/QA test
> script already written for this exact module (skip the Electron/biometric sections
> — this is a web app, not desktop). Use it verbatim as the phase 8 acceptance test
> rather than writing a new one.

## 09 · Stack reference

| Concern | Choice |
|---|---|
| Language | TypeScript, front and back |
| Frontend framework | Next.js 14 (App Router) |
| Backend framework | NestJS |
| UI primitives | Tailwind CSS + Radix UI |
| Animation | Framer Motion (UI/layout), GSAP (sequenced/scroll) |
| Charts | Recharts / visx |
| Server/client state | React Query + Zustand |
| ORM | Prisma, introspected from the existing PostgreSQL/Flyway schema |
| Auth | Custom JWT module + `@azure/msal-node` for Entra ID |
| Vault crypto | Ported `vault-crypto.js` — Argon2id (hash-wasm), AES-256-GCM, RSA-OAEP-3072, native Web Crypto API — unchanged |
| PDF export | Puppeteer or `@react-pdf/renderer` |
| Testing | Vitest/Jest (unit), Playwright (e2e), dedicated crypto/RBAC suite |
| CI/CD | Existing GitHub Actions workflows adapted (`ci.yaml`, `cd-staging.yaml`, `cd-prod.yaml`) |

## 10 · Rough timeline

| Phase | Weeks |
|---|---|
| 0 · Discovery & parity baseline | 2–3 |
| 1 · Platform foundation | 4–5 |
| 2 · Password Manager & Policy Management | 5–6 |
| 3 · Core operations | 5–6 |
| 4 · Resource & time modules | 3–4 |
| 5 · Admin & Settings | 3–4 |
| 6 · Interview & Assessment | 4–5 |
| 7 · Analytics, reporting, AI agent | 3–4 |
| 8 · Security hardening & regression | 3–4 |
| 9 · Parallel run & cutover | 2–3 |

Total: roughly **34–44 weeks** (8–10 months) for a team of 4–6 engineers, some
phases overlapping. This is a planning estimate — it tightens once phase 0 has
actually opened `OrgPortalBackend`.

## 11 · Key risks

| Risk | Severity | Mitigation |
|---|---|---|
| OAuth2 opaque-code pattern gets simplified/regressed during the Node port | **High** | Treat it as a named, tested requirement in phase 1, not an implementation detail |
| Interview module's sandboxed code execution reimplemented without equivalent isolation | **High** | Dedicated security design review before phase 6 closes; containerized execution, not in-process eval |
| AI Agent boundary drifts and vault data becomes reachable from AI code paths | **High** | Enforce as an architectural separation (distinct service/route scope + tests), not a coding convention |
| Prisma schema hand-authored instead of introspected, drifting from the real 50-migration schema | Medium | `prisma db pull` against staging in phase 0; never hand-model |
| RBAC gaps across 7 roles during the rewrite | Medium | Port backend guards before frontend gates; test authorization boundaries per role, not just per page |
| Team unfamiliarity with NestJS/Next.js slows early phases | Low | Short ramp-up spike before phase 1; pair on the auth flow first since everything depends on it |

## 12 · Next steps

To move phase 0 from "inferred from the frontend README" to grounded fact:

- [x] Read access to `OrgPortalBackend` — Flyway migrations, `application.properties`, service/controller source.
- [ ] The Microsoft Entra ID app registration details (client ID, redirect URIs, Graph scopes, tenant).
- [ ] A staging database snapshot (or connection) for the Prisma introspection pass.
- [ ] Confirmation from whoever owns `UI_MODERNIZATION_PLAN.md` that it's being superseded, so effort doesn't get duplicated on the old plan's phase 1/2 work.

---

*orgportal-stack-migration · full rewrite · Next.js + NestJS · Framer Motion / GSAP*
