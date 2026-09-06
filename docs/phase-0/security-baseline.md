# Phase 0 — Security Baseline for the Next.js + NestJS Rewrite

**Purpose:** This is the security floor for the rewrite. It consolidates every known vulnerability, invariant, and acceptance test from the three existing baseline documents so that the new stack (a) cannot reintroduce a known finding, and (b) reuses the existing QA/security script rather than inventing a new one.

**Source documents (baseline, read in full):**

| Ref | Document | Date | Nature |
|---|---|---|---|
| **[SCRIPT]** | `Apps/Password Manager Application.txt` | — | The existing security/QA test brief (19 sections). Written assuming an Electron desktop app. |
| **[AUDIT]** | `Apps/Password-Manager-Security-Audit-Report.md` | 2026-09-02 | Static, read-only, end-to-end source review of the Laravel + Spring Boot implementation. Findings F1–F21. Verdict: **⚠️ Ready with required fixes**, overall **6.5/10**. |
| **[POC]** | `Apps/XSS-Vault-Key-Theft-PoC.md` | 2026-09-02 | Critical stored-XSS → live vault key theft, confirmed by static review, **not yet fixed**. |

**Legacy stack being replaced:** `OrgPortalFrontend` (Laravel/PHP + vanilla JS) + `OrgPortalBackend` (Spring Boot 3.5.6 / Java 21).
**Target stack:** Next.js (App Router, React) + NestJS.

**Important scoping correction carried forward from [AUDIT] §Correction:**

> "The source spec (`Password Manager Application.txt`) assumes an **Electron desktop app** with biometric/fingerprint auth and IPC channels. The actual application is a **web app** (Laravel frontend, Spring Boot backend) with no Electron shell and no biometric/fingerprint integration anywhere in the code. Sections 8–10 of the original brief (Electron security, IPC security, biometric auth) are marked **N/A**."

The rewrite is also a web app. Section 5 of this document therefore marks Electron/IPC/biometric items **SKIP-DESKTOP** — but where the *intent* of a desktop item transfers to a web boundary (privileged RPC validation, navigation restriction, remote content loading), a **WEB analogue item is added** so no original intent is lost.

**Status of the baseline as of this document:** every open finding below is open in the *legacy* app. None of it is fixed by the rewrite automatically. Each finding is converted into an architectural requirement that must be satisfied by construction in the new stack.

---

## 1. Known vulnerabilities inventory

Severity uses the [SCRIPT] §18 scale: 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low / 🔵 Informational.

Column meaning:
- **Root cause** — one sentence, from the source document.
- **Doc status** — what the source document says (fixed / open / not-yet-performed).
- **Requirement for the new stack (R-nn)** — concrete and testable. This is the load-bearing column.

### 🔴 Critical

#### V-XSS-01 — Stored XSS in the vault Send/Share modal → live vault key theft
*(source: [POC], entire document; the [AUDIT] did not catch this because it was a separate review)*

- **Severity:** 🔴 Critical. CWE-79 chained with CWE-522.
- **Root cause:** An attacker-controlled user display name is stored unsanitized, exposed to every authenticated caller, and then concatenated raw into `.innerHTML` in the Send modal, where the CSP's `script-src-attr 'unsafe-inline'` allows the injected inline event-handler attribute to execute inside an already-unlocked vault tab and read the live session key out of `window.VaultSession`.
- **Doc status:** **Open.** [POC] §7: "Fix applied — Not yet performed", "Retest after fix — Pending". Confirmed via static code review; PoC not yet executed live.
- **Requirements:** see **R-01 … R-06** in §2 below. This finding is decomposed and treated in full in §2 because it is the single most important thing the rewrite must make structurally impossible.

#### V-F1 — Non-canonical roles silently escalated to full Admin
- **Severity:** 🔴 Critical.
- **Module / location:** Authorization / JWT filter — `JwtAuthFilter.java:70-73`.
- **Root cause:** The JWT filter's role normalisation **fails open** — any role string that is not exactly `Admin` or `User` is rewritten to `Admin`:

  ```java
  String role = RoleNormalizer.normalize(rawRole);
  if (!Role.ADMIN.equals(role) && !Role.USER.equals(role)) {
      role = Role.ADMIN;
  }
  ```

- **Impact ([AUDIT] F1):** the DB-seeded `Guest` role (documented as *"Seat Booking only — no other module access"*) is granted `ROLE_Admin`, so every `@PreAuthorize("hasRole('Admin')")` gate passes — including `PasswordEntryController`, `VaultKeyController`, `VaultGroupController`, `PasswordSharingController`, `PasswordFolderController` and `AuditLogController` (the entire vault module **and its audit trail**).
- **Doc status:** **Open** — "Not fixed — open." Called a **release blocker** in [AUDIT] §5.
- **Requirement R-07 (fail-closed authorization):** Role/authority resolution must be a **closed mapping with no default-to-privilege branch**. In NestJS: parse the JWT role through a strict enum validator (e.g. `zod`/`class-validator` enum or a `Record<string, Role>` lookup); an unrecognised value **rejects the request with 401**, never coerces. Testable assertions:
  1. A JWT whose role claim is `Guest` receives **403** on every vault endpoint.
  2. A JWT whose role claim is an unknown string (`"Contractor"`, `""`, `null`, an array, a number) receives **401/403** — never 200.
  3. No code path anywhere in the repo assigns an elevated role as a fallback. Enforce with a lint/grep gate in CI: no assignment of an admin-level role inside an `else`/negated-comparison branch.
  4. Every vault route is covered by an explicit allow-list of roles; a route with no role decorator is denied by a global default-deny guard, not allowed.

### 🟠 High

#### V-F2 — No brute-force protection / rate limiting on login
- **Severity:** 🟠 High.
- **Location:** `AuthController.java:42-51`, `AuthService.java:45-71`, `SecurityConfig.java:52-54` (`/api/auth/login` is `permitAll`).
- **Root cause:** No failed-attempt counter, lockout, backoff, or CAPTCHA exists anywhere on the auth endpoints — a repo-wide grep for `RateLimit|Bucket4j|failedAttempt|lockout|maxAttempts|throttl` "returns nothing wired to auth endpoints."
- **Doc status:** **Open** — "Not fixed — open."
- **Requirement R-08 (throttle + lockout on every credential-guessing surface):** Rate limiting must be applied as a **global NestJS guard with an explicit per-route policy**, not opt-in per controller. Concretely: `@nestjs/throttler` with a Redis storage adapter (so limits survive restarts and hold across instances), keyed on **both** account identifier and client IP. Login: 5 failures per account per 15 min → exponential backoff, then temporary lockout; 20 requests/min per IP hard ceiling. Testable: 6 sequential wrong-password requests to one account return 429/locked; the counter is not resettable by changing IP alone, nor by changing the account alone.

#### V-F3 — No brute-force protection on Vault MFA (TOTP) verify/disable
- **Severity:** 🟠 High.
- **Location:** `TotpService.java:43-51`, `VaultKeyService.java:91-123`.
- **Root cause:** `confirmMfa`/`verifyMfa`/`disableMfa` call `totpService.verifyCode()` with no attempt counting, so a 6-digit code (1,000,000 combinations with a ±1-step drift window) is brute-forceable — and per [AUDIT], "this is the only gate standing between an attacker and `GET /api/vault/keys` (wrapped Vault Key material)."
- **Doc status:** **Open** — "Not fixed — open."
- **Requirement R-09 (MFA lockout + constant-time compare + alerting):** TOTP verification must be rate-limited **per user** (max 5 failures → lock verification for N minutes, N ≥ 15), use a constant-time comparison, log every failure to the audit trail, and emit an alert on repeated failure. `disableMfa` counts as a sensitive action and requires re-authentication (see R-19). Testable: the 6th consecutive bad code returns locked/429 regardless of source IP; `GET /vault/keys` is unreachable while MFA verification is locked.

### 🟡 Medium

#### V-F4 — Vault module entirely Admin-gated, widening F1's blast radius
- **Severity:** 🟡 Medium (amplifier for V-F1).
- **Location:** class-level `@PreAuthorize("hasRole('Admin')")` on all five vault controllers.
- **Root cause:** Because the *whole* vault module keys off one coarse role, the F1 escalation bug hands every non-Admin/non-User role the entire module rather than a single feature — and, conversely, regular `User`-role employees "currently cannot reach it at all," which [AUDIT] flags as a possible functional gap.
- **Doc status:** **Open** — "Not fixed — open."
- **Requirement R-10 (deliberate, per-route authorization matrix):** Authorization for vault routes must be expressed as an explicit, reviewed matrix of `{route × role × ownership tier}` checked into the repo, not a blanket class-level role. Ownership must remain a **second, independent check** (R-11) so a role mistake alone never yields data. Testable: a table-driven test iterates the matrix and asserts the exact status code for every (role, route) pair, including roles that should be denied.

#### V-F5 — No server-side password strength policy on account (login) passwords
- **Severity:** 🟡 Medium.
- **Location:** `RegisterRequest.java:12-17` — only `@NotBlank`, no length or complexity constraint.
- **Root cause:** `PasswordPolicyService` governs only *generated vault* passwords, and `/api/auth/signup` is `permitAll`, so "a 1-character account password is accepted server-side regardless of any client-side check."
- **Doc status:** **Open** — "Not fixed — open."
- **Requirement R-12 (server-side strength policy, client check is decoration):** All password/passphrase strength rules live in a single server-side validator (NestJS DTO + `class-validator`, or `zod` schema) applied to signup, password change and password reset. Minimum: length ≥ 12 for account passwords, ≥ 14 for the master password, plus a breached-password/common-list rejection. Testable: a direct API call bypassing the UI with a 1-character password returns 400; the same test runs for every password-accepting endpoint (signup, change, reset, master-password set, master-password rotate).

### 🟢 Low

#### V-F6 — `JWT_SECRET` / `DB_PASSWORD` fall back to well-known placeholders
- **Severity:** 🟢 Low (High in practical impact if it ever ships).
- **Location:** `application.properties:22,59,61` — `spring.datasource.password=${DB_PASSWORD:1234}`, `app.jwt.secret=${JWT_SECRET:change-this-secret-in-production}`.
- **Root cause:** Config defaults let the app boot with a guessable secret if an env var is forgotten; "an attacker who knows the fallback can forge valid JWTs for any user/role."
- **Doc status:** Open (no fix noted). [AUDIT] notes the correct pattern already exists elsewhere: `ENCRYPTION_KEY` in `CredentialCipherService` fails fast.
- **Requirement R-13 (fail-fast config, no secret defaults):** Config is validated at boot by a schema (`zod`/`joi` via `ConfigModule.forRoot({ validationSchema })`) in which every secret is **required with no default** and constrained (e.g. JWT secret ≥ 32 bytes of entropy). The process **refuses to start** on a missing or placeholder secret. Testable: a boot test with each secret env var unset asserts a non-zero exit; a grep gate in CI fails on any literal default beside a name matching `SECRET|PASSWORD|KEY|TOKEN`.

#### V-F7 — Refresh-token secret silently reuses the access-token secret
- **Severity:** 🟢 Low.
- **Location:** `application.properties:61`.
- **Root cause:** `JWT_REFRESH_SECRET` falls back to the access-token secret when unset, collapsing the separation between the two token types.
- **Doc status:** Open (no fix noted).
- **Requirement R-14 (distinct key material per token class):** Access and refresh tokens must be signed with distinct, independently required secrets, and must carry a `typ` claim that is verified — an access token must be rejected at the refresh endpoint and vice-versa. Testable: presenting a refresh token as a bearer access token returns 401; presenting an access token to `/auth/refresh` returns 401; boot fails if the two secrets are equal.

#### V-F8 — TOTP code comparison is not constant-time
- **Severity:** 🟢 Low.
- **Location:** `TotpService.java:48` (`String.equals`).
- **Root cause:** Non-constant-time string comparison of the TOTP code; "theoretical timing side-channel ... but compounds with F3."
- **Doc status:** Open. Remediation: `MessageDigest.isEqual()`; "primary fix is the rate limiting in F3."
- **Requirement R-15 (constant-time comparison for every secret comparison):** All comparisons of secrets, codes, tokens and MACs use `crypto.timingSafeEqual` on equal-length buffers. Testable: CI grep gate — no `===`/`==`/`.equals` comparison against a variable named like a code/token/secret/hash in server code; unit test that the compare helper is used by the TOTP and share-link paths.

#### V-F9 — `DataIntegrityViolationException` handler echoes raw DB message to the client
- **Severity:** 🟢 Low.
- **Location:** `GlobalExceptionHandler.java:68-75`.
- **Root cause:** The DB integrity error handler returns the raw driver message, leaking "table/column/constraint names in 400 responses."
- **Doc status:** Open.
- **Requirement R-16 (opaque errors outward, detail inward only):** A single global NestJS exception filter maps every unhandled/DB error to a generic, stable client message plus a correlation id, and logs the detail server-side only. No ORM/driver error object is ever serialised into a response. Testable: an integration test forcing a unique-constraint violation asserts the response body contains no table, column or constraint name and no SQL fragment; a snapshot test over the error-shape schema.

#### V-F10 — Swagger/OpenAPI publicly exposed with no auth
- **Severity:** 🟢 Low.
- **Location:** `SecurityConfig.java:73-87`, `application.properties:11-17,136-146`.
- **Root cause:** The full API surface (paths, DTO shapes) is served to unauthenticated visitors — "reconnaissance aid, no direct data leak."
- **Doc status:** Open.
- **Requirement R-17 (docs off or gated in production):** `SwaggerModule.setup()` is called only when `NODE_ENV !== 'production'`, or is mounted behind an admin-authenticated guard. Testable: an unauthenticated GET of `/docs`, `/docs-json`, `/swagger`, `/api-json` against a production-mode build returns 404/401.

#### V-F11 — No server-side logout / token revocation (stateless JWT only)
- **Severity:** 🟢 Low.
- **Location:** `AuthController.java:90-96` — logout is client-discards-token only.
- **Root cause:** Logout does not invalidate anything server-side, so "a captured access token remains valid up to 1 hour, and a captured refresh token up to 7 days, after the user 'logs out.'" Partially mitigated by the existing `tokenVersion` mechanism, which today fires only on role change / deactivation / password reset.
- **Doc status:** Open.
- **Requirement R-18 (real server-side revocation on logout):** Logout must invalidate server-side — bump a per-user `tokenVersion`/`sessionEpoch` that every token verification checks, **and** delete the refresh cookie. Access-token TTL ≤ 15 minutes so the residual window is bounded even in the worst case. Testable: capture a valid access token, call logout, replay the token → 401; replay the refresh token → 401.

#### V-F12 — No idle-timeout / lock on tab-blur beyond 5-minute inactivity
- **Severity:** 🟢 Low.
- **Location:** `vault-session.js:19-35, 281` — locks after 5 min of no mouse/keyboard/scroll, or on `pagehide`.
- **Root cause:** No lock on `visibilitychange`/`blur`, so "a user who unlocks the vault and then walks away from a still-open, still-focused tab remains unlocked for up to 5 minutes." [AUDIT] notes the correct pattern already exists in `share-link-view.blade.php:148-152`.
- **Doc status:** Open.
- **Requirement R-19 (multi-trigger auto-lock + re-auth for sensitive actions):** The client vault lock must fire on **all** of: idle timer (≤ 5 min, configurable down), `visibilitychange` to hidden for more than a short grace period (≤ 60 s), `pagehide`, `beforeunload`, explicit lock, logout, and any auth error from the API. Locking zeroes the in-memory key material (R-04). Sensitive actions (reveal, export, share, disable MFA, rotate master password) require re-authentication regardless of lock state. Testable in Playwright: unlock, switch to a background tab past the grace period, return → the reveal action requires unlock again.

#### V-F13 — Raw bearer JWT shared into every view's variable scope
- **Severity:** 🟢 Low.
- **Location:** `JwtAuth.php:79-81` — `view()->share('jwtToken', session('jwt_token'))`.
- **Root cause:** The raw bearer token is placed in template scope for every render; no view echoes it today (verified by grep) "but it is one accidental `{{ $jwtToken }}` away from exposing a live bearer token to any XSS elsewhere in the app."
- **Doc status:** Open (latent, not live).
- **Requirement R-20 (tokens never enter render scope or client JS):** Session/auth tokens live **only** in `HttpOnly` cookies. They must never be passed as props, embedded in `__NEXT_DATA__`/RSC payloads, placed in a React context, or returned by a server action. Next.js specifics: read the token inside server components / route handlers via `cookies()`; never `return` it from a server function; never put it in a `use client` boundary prop. Testable: fetch every authenticated page's HTML and assert the raw token string does not appear anywhere in the response body or in any hydration payload — run this as a Playwright assertion over the rendered document plus a check of `window.__NEXT_DATA__`.

#### V-F14 — Debug `console.log`/`console.error` of share-grant objects in production JS
- **Severity:** 🟢 Low.
- **Location:** `share-modal.blade.php:158-159,178,186`, `send-modal.blade.php:154,204,227,242`, `item-modal.blade.php:206,212`.
- **Root cause:** Debug logging left in shipped JS prints RSA-wrapped Entry Key ciphertext to the browser console — "not plaintext-recoverable without the recipient's private key, but unnecessary debug output shipped to production and a bad precedent."
- **Doc status:** Open.
- **Requirement R-21 (no console output from crypto paths in production):** Vault crypto and key-handling modules contain zero `console.*` calls; enforced by ESLint (`no-console: error` scoped to `**/vault/**` and the crypto module) plus a production build step that strips `console` (`compiler.removeConsole` in `next.config`). Testable: a Playwright run of the full vault workflow asserts the captured console message list is empty; a lint gate fails the build on any `console.*` in the vault path.

#### V-F15 — Client-supplied Argon2id KDF parameters have no confirmed server-side floor
- **Severity:** 🟢 Low.
- **Location:** `vault-crypto.js:24` (hardcoded `memorySize: 64MB, iterations: 3`), forwarded verbatim by `PasswordManagerController::vaultSetup`.
- **Root cause:** KDF parameters are chosen client-side and persisted as submitted; the current values meet the OWASP baseline, but "if the Java API doesn't independently validate a minimum floor on submitted `kdfParams`, a tampered client could persist weaker parameters."
- **Doc status:** Open.
- **Requirement R-22 (server-side KDF floor, validated on write):** `kdfParams` is validated server-side against a hard minimum floor (algorithm must be `argon2id`; memory ≥ 64 MiB; iterations ≥ 3; parallelism ≥ 1; salt length ≥ 16 bytes) on **every** write path (vault setup, master-password rotation, recovery-key regeneration). Anything below the floor is rejected with 400; anything above is accepted. Note this is the one place where the server *does* validate a crypto-related field — and it is legitimate precisely because `kdfParams` is **metadata, not plaintext** (see ZK-06). Testable: POST a downgraded parameter set directly to the API and assert 400 plus no DB mutation.

### 🔵 Informational

| ID | Finding | Location | Requirement for the new stack |
|---|---|---|---|
| **V-F16** | No key-rotation mechanism for vault Entry Keys (`keyVersion` reserved but unused) | `PasswordEntry.java:72-74` | **R-23:** Ship envelope-versioned ciphertext from day one — every encrypted record stores `keyVersion` + `alg` and the decrypt path dispatches on them. A rotation job must exist (even if unused) so rotation is not a schema migration later. Testable: a record written at v1 still decrypts after a v2 key is introduced. |
| **V-F17** | No HSTS header at the app level | `SecurityConfig.java` | **R-24:** Set HSTS in the app itself (`max-age=63072000; includeSubDomains; preload`) rather than relying on the proxy, so the guarantee is not lost by an infra change. Testable: header assertion. |
| **V-F18** | Modulo bias (`arr[0] % max`) in generator index selection; CSPRNG source itself correct | `password-generator.js:16-20` | **R-25:** Use rejection sampling over `crypto.getRandomValues` (or `crypto.randomInt` server-side). Never `Math.random()`. Testable: a statistical uniformity check over a large sample plus a grep gate banning `Math.random` in the repo. |
| **V-F19** | `/password-manager/{id}/reveal` is a GET returning ciphertext | `routes/web.php:370` | **R-26:** Reveal, export and any secret-returning endpoint is `POST` with `Cache-Control: no-store`, so nothing lands in proxy logs, browser history or the back/forward cache. Testable: assert the route rejects GET and that the response carries `no-store`. |
| **V-F20** | Vault INFO logs contain PII (email, user id, role) but never secrets | `AuthService.java:241-247`, `logs/app.log` | **R-27:** Structured logging with a field allow-list and a redaction serialiser (e.g. `pino` with `redact` paths). PII is logged only where required by the audit trail, at controlled retention. Testable: a log-scraping test over a full workflow asserts no secret-shaped field and no plaintext appears (see ZK test hooks). |
| **V-F21** | No shared-key rotation on share revocation — a recipient who unwrapped a key before revocation can still decrypt old ciphertext | `vault-crypto.js:319-324` | **R-28:** Revocation must trigger **re-encryption of the secret under a new Entry Key** (client-side), not just deletion of the grant row, and the UI must state plainly that revocation without rotation does not un-know a known secret. Testable: after revoke, the previously issued wrapped key no longer decrypts the current ciphertext. |

### Baseline strengths that must be preserved, not just "not regressed"

[AUDIT] §3 lists what the legacy app does **right**. These are requirements too — losing one is a regression even though it is not a numbered finding.

| ID | Property preserved from [AUDIT] §3 | Requirement |
|---|---|---|
| **P-01** | "Server never holds a plaintext master password, Vault Key, recovery key, or private key ... A full database dump alone is useless without each user's master password." | R-29: see §3, all ZK invariants. |
| **P-02** | "Real AEAD crypto throughout: AES-256-GCM for vault secrets and Entry Key wrapping, RSA-OAEP-3072 for cross-user key sharing, all via native Web Crypto (no hand-rolled cipher). Fresh random IV per operation, no reuse." | R-30: Web Crypto only; no crypto npm dependency for vault primitives; fresh 12-byte IV per encryption, asserted by test. |
| **P-03** | Argon2id at OWASP-baseline parameters with a per-derivation random salt. | R-22 (floor), plus a per-user random salt of ≥ 16 bytes, never reused. |
| **P-04** | CSPRNG (`crypto.getRandomValues`) for password generation and recovery keys, never `Math.random()`. | R-25. |
| **P-05** | "In-memory-only session keys — unwrapped Vault Key/private key live only in a JS closure, never in `localStorage`/`sessionStorage`, cleared on 5-minute idle or tab close." | R-04 (§2) — tightened for React. |
| **P-06** | "Clipboard auto-clear after 45 seconds with a generation-counter guard so it never wipes a newer, unrelated clipboard value." | R-31 (§6). |
| **P-07** | Per-operation ownership/membership checks in three correctly-scoped tiers (view/edit/owner-only). | R-11: ownership is enforced in the service layer on every operation, independent of role. |
| **P-08** | UUID primary keys everywhere in the vault schema — no sequential-ID IDOR surface. | R-32: UUIDv4/v7 PKs for all vault tables; no integer ids in any vault URL or payload. |
| **P-09** | Anti-enumeration design in `VaultShareLinkService` — wrong-recipient and nonexistent share links return the identical response shape. | R-33: identical status code, body shape and response timing for "not found" and "not yours" on every vault resource. |
| **P-10** | Full audit logging (actor, IP, user-agent) on every reveal/share/create/delete/purge. | R-34: audit write is in the same transaction as the action; an action that cannot be audited fails. |
| **P-11** | `@JsonIgnore` on every sensitive field — password hash, all ciphertext/IV/wrapped-key columns, TOTP secret. | R-35: serialisation is **allow-list** based (NestJS `ClassSerializerInterceptor` with `@Expose` opt-in, or explicit DTO mapping). Never return an ORM entity directly. |
| **P-12** | "No SQL injection surface — 100% parameterized JPQL/Criteria queries." | R-36: ORM/parameterised queries only; any raw SQL requires a reviewed exception and parameter binding. |
| **P-13** | Generic error responses to clients; detail logged server-side only. | R-16. |
| **P-14** | "Strict, nonce-based CSP specifically on `/password-manager*` routes, tighter than the rest of the app." | R-01/R-02 (§2) — the strict policy becomes the **global default**, not a per-route exception. |
| **P-15** | CSRF protection intact on every vault route; every vault AJAX call attaches the token. | R-37 (§6). |
| **P-16** | Token-version-based JWT revocation on role change/deactivation/password reset. | R-18, extended to logout. |
| **P-17** | "No AI/LLM exposure ... the app's separate AI-chat feature is architecturally and route-wise disjoint from the password manager; no vault data can reach it." | §4, R-38 … R-42. |

---

## 2. The XSS vault-key-theft PoC — chain, structural fix, and React invariants

### 2.1 What the attack actually was

[POC] §1 states the essential point plainly:

> "This defeats the zero-knowledge design not by breaking the cryptography, but by riding along after the legitimate user does the unlocking."

The cryptography was never attacked. The attacker obtained plaintext by getting a few lines of JavaScript to execute **inside a tab that had already legitimately unlocked the vault**, and then calling the application's own public API surface. No master password, no server compromise, no crypto weakness.

### 2.2 The chain, step by step, in defensive terms

**Step 0 — Preconditions ([POC] §3).** The attacker controls an account whose display name they can set (self-registration, or an SSO display name the org does not lock down), and that account has **not** set up a vault — which is the default state of a fresh account. The victim is any user with an unlocked vault who opens the Send/"Share via Link" modal. Critically: *"no specific selection of the attacker's account is required"* and *"no interaction from the victim beyond 'use the vault normally'"*. There is no admin escalation step.

**Step 1 — Injection point (the source).** `AuthService.java:142`:

```java
user.setName(name != null ? name : email);
```

The display name is persisted with **no HTML sanitisation and no charset/length constraint** — inconsistently with the same codebase's own correct handling of rich text, where `PasswordPolicyService.java:115-116` runs `documentContent` through `HtmlSanitizer`/Jsoup. So the store accepts markup in a field that is only ever meant to be a human name.

**Step 2 — Distribution (the amplifier).** `UserController.java:65-68` — `GET /api/users/assignable` is annotated *"Available to any authenticated user, not just Admins."* It returns every user's unsanitised `name`. One poisoned row is therefore delivered to every authenticated client in the org.

**Step 3 — The sink (where it becomes code).** `send-modal.blade.php:179,206,229`:

```js
row.innerHTML = '<span>' + (user ? user.name : userId) + ' — has not set up their vault yet, cannot receive a link</span>';
```

An API-sourced string is concatenated into `.innerHTML`. That call parses its argument as HTML, so any markup in the name becomes live DOM. And this branch is the *automatic* branch: it renders for **every listed user who has not set up a vault**, so merely opening the modal is enough.

The same repository contains the correct pattern one file over, `share-modal.blade.php:98`:

```js
nameEl.textContent = u.name; // correctly escaped — not the vulnerable pattern
```

This is the shape of the bug: not a missing security concept, but **one inconsistent instance of a pattern the team otherwise gets right**. That is exactly the failure mode that a framework-level invariant prevents and a code-review habit does not.

**Step 4 — Why the CSP did not stop it.** `SecurityHeaders.php:59` contains:

```
script-src-attr 'unsafe-inline'
```

The vault's CSP correctly nonce-locks `<script>` **elements** — but `script-src-attr` is a *separate* directive governing inline **event-handler attributes** (`onerror=`, `onload=`, and friends). Setting it to `'unsafe-inline'` explicitly re-permits the one execution vector that `innerHTML` injection can reach: an injected element that carries an event-handler attribute which fires on its own, with no user interaction. Nonce-locking script tags is not protection if attribute handlers are still allowed.

**Step 5 — Reaching the key material.** `vault-session.js:253,271-277`:

```js
function getSessionSync() { return session; }
window.VaultSession = { ensureUnlocked, getSessionSync, ensureGroupKey, lock, api };
```

The unwrapped session — including the live vault key — is reachable **synchronously from a global**. And by construction the vault is already unlocked at this moment, because `send-modal.blade.php:149` calls `await window.VaultSession.ensureUnlocked()` *before* the vulnerable render runs. So the injected code inherits a guaranteed-unlocked state.

**Step 6 — Producing plaintext.** The injected script does not decrypt anything itself. It calls the application's **own** same-origin reveal endpoint (the victim's cookies attach automatically) and the application's **own** `window.VaultCrypto.decryptRevealed()` with the session object from Step 5. Legitimate code path, legitimate key, attacker's caller.

**Step 7 — Exfiltration.** `connect-src 'self' <api origin>` does block `fetch`/XHR to an external host — but, per [POC] §2.4, it "does **not** restrict top-level navigation (`window.location = ...`), which remains a viable exfiltration channel." **This is the most important architectural lesson in the whole document: once script executes in an unlocked vault origin, CSP cannot reliably contain the exfiltration.** Therefore CSP must be treated as the control that prevents *execution*, never as the control that contains *consequences*.

*(This document deliberately describes the injection class — HTML injection of an element bearing a self-firing inline event-handler attribute, delivered through an `innerHTML` sink — and the sink itself, rather than reproducing the copy-pasteable strings in [POC] §4. Anyone reproducing this for retest should work from [POC] §4 directly, against their own test account and test entry, per the warning in that section.)*

### 2.3 Impact, as stated

[POC] §5:

> "**Confidentiality:** Full plaintext disclosure of any vault entry the victim can access (owned, group, or shared), without needing the victim's master password, recovery key, or any server-side compromise."
> "**Scope:** Any user who can create an account ... can weaponize this against any vault user in the org."
> "**Defeats the core security property** the module is built around (zero-knowledge encryption) via a client-side rendering bug rather than a cryptographic flaw."

### 2.4 The exact structural fix

[POC] §6 gives five remediation steps. Mapped to the rewrite:

1. **Fix the sink** — never build DOM from concatenated strings; use text nodes. In React this is `{user.name}`, which escapes by default. → **R-01**
2. **Fix the source** — sanitise/validate `name` at write time, with a length and charset limit consistent with a display name. → **R-05**
3. **Tighten CSP** — remove `script-src-attr 'unsafe-inline'`; migrate any legitimate inline handler to a nonce-covered script attaching listeners. → **R-02**
4. **Audit for the same pattern elsewhere** — grep for other `.innerHTML =` sinks fed by API-sourced display names. → **R-03** (make it a CI gate, not a one-time grep)
5. **Retest** — confirm the payload renders as inert text. → §7 test hooks

But note what fixes 1–4 have in common: they all prevent *execution*. None of them protects the key if execution happens anyway (Step 7 shows why). So the rewrite adds a fifth, deeper fix that the legacy app lacks: **make the key unreachable even from code running in the page.** → **R-04**

### 2.5 Invariants the React rewrite must hold

These are the non-negotiables. Each is written to be checkable.

**R-01 — No raw-HTML sink anywhere in the vault surface.**
`dangerouslySetInnerHTML` is **banned outright** in any component under the vault route group and in any component that renders user-, API-, or DB-sourced strings. Also banned: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `Element.setAttribute` with an `on*` name, and `new Function`/`eval`. All user-controlled text renders as JSX children or via `textContent`.
*Enforcement:* ESLint `react/no-danger: error` repo-wide (not just warn), plus a CI grep gate for the banned identifiers. *Test:* a fixture user whose display name contains angle-bracketed markup is rendered in every list, modal and detail view; the assertion is that the markup appears as **visible literal text** and that zero script executes (Playwright: no console entries, no unexpected navigation, no network request to an unexpected host).

**R-02 — CSP that makes attribute handlers impossible, applied globally.**
The strict policy is the **default for the whole app**, not a per-route exception as in the legacy `SecurityHeaders.php`. It must include, non-negotiably:
- `script-src-attr 'none'` — *the specific directive whose `'unsafe-inline'` value enabled this attack.* This one line is the single highest-value change in the whole rewrite.
- `script-src 'self' 'nonce-<per-request>' 'strict-dynamic'` — no `'unsafe-inline'`, no `'unsafe-eval'` in production.
- `require-trusted-types-for 'script'` plus a `trusted-types` allow-list — this makes an unsafe DOM sink throw at runtime rather than execute, which is the browser-level enforcement of R-01.
- `object-src 'none'`, `base-uri 'none'`, `frame-ancestors 'none'`, `form-action 'self'`, `default-src 'none'`.
See §6 for the full header text.
*Test:* assert the exact header value on every route (a snapshot test), and specifically assert that `script-src-attr` is present and equals `'none'`.

**R-03 — The inconsistency that caused this must be structurally impossible.**
The legacy bug existed because two sibling files handled the same value two different ways. The rewrite must render a user display name through **exactly one component** (e.g. `<UserName user={…} />`); no other component takes a name string and renders it. Any place needing a name imports that component.
*Test:* a CI grep gate asserting `user.name` / `displayName` is not interpolated outside that component; a unit test on the component with a markup-bearing name.

**R-04 — Where the master key and vault key may live.**
This is the invariant the legacy app did not have, and the reason the PoC reached plaintext.
- Derived key material (master key, unwrapped vault key, unwrapped private key) **must never be assigned to `window`, `globalThis`, a module-level `export`, a React context value, a Redux/Zustand store, a ref exposed by a component, or any property reachable by property enumeration from page script.** The legacy `window.VaultSession = { getSessionSync, … }` is precisely the pattern that is banned.
- It must never be written to `localStorage`, `sessionStorage`, IndexedDB, a cookie, a URL, or a React server-component payload. (This part [AUDIT] §3/P-05 already got right — keep it.)
- Preferred structure: keys live as **non-extractable `CryptoKey` objects** (`crypto.subtle.importKey`/`deriveKey` with `extractable: false`) held inside a **dedicated Web Worker** (or a module-scoped closure with no exported getter, at minimum). The main thread holds only an opaque handle and posts *operations* — "decrypt this ciphertext, return plaintext for this one field" — never "give me the key". Non-extractable `CryptoKey` means that even code that reaches the handle cannot export raw bytes.
- **No synchronous key getter may exist.** `getSessionSync()` is a banned shape: any function returning key material is a direct capability grant to injected script.
- Every decrypt operation through the worker boundary is **rate-limited and audited client-side** (e.g. max N reveals per minute, each requiring a user-gesture token), so a script that does reach the boundary cannot silently bulk-decrypt the whole vault.
- Lock (R-19) must **zero and drop** the key handles, and the worker should be terminated on lock so that its heap goes with it.
*Test:* Playwright — after unlock, evaluate in page context and assert that no enumerable global holds a `CryptoKey` or key-like bytes, that no exported function returns key material, and that `crypto.subtle.exportKey` on any reachable handle rejects. Plus a CI grep gate: no assignment to `window.*` / `globalThis.*` in the vault module.

**R-05 — Validate and constrain identity fields at the source.**
Display name (and every other free-text identity field, including SSO-sourced ones) is validated at write time in NestJS: max length, an allow-list charset appropriate to names, and rejection (not stripping) of angle brackets and control characters. Applied on **every** write path — self-registration, admin creation, profile edit, and SSO/JIT provisioning claim mapping. SSO claims are untrusted input, exactly like form input.
*Test:* POST a markup-bearing name to each write path and assert 400 and no DB row/mutation.

**R-06 — Reduce distribution of user-directory data.**
The legacy `/api/users/assignable` handed every authenticated caller the whole user directory, which is what turned one poisoned row into an org-wide payload. The rewrite must scope recipient lookup to what the action needs: prefer server-side typeahead search returning bounded results, require an explicit minimum query length, rate-limit it, and return only the fields the picker renders. Do not ship a "list all users" endpoint to non-admins.
*Test:* an authenticated non-admin call with an empty query returns no rows; the endpoint enforces a result cap and is rate-limited.

**R-06a — Clipboard is a key-adjacent surface.**
Injected script in an unlocked tab can also read the clipboard if permission is granted. Never request `clipboard-read`; set `Permissions-Policy: clipboard-read=()`. Copy-to-clipboard uses `navigator.clipboard.writeText` from within a user gesture only, with the auto-clear guard of R-31.

---

## 3. Zero-knowledge invariants

Extracted from [AUDIT] §3 ("Server never holds a plaintext master password, Vault Key, recovery key, or private key — verified end-to-end ... A full database dump alone is useless without each user's master password") and from [SCRIPT] §3, §4, §12, §13. Each is phrased as an assertion that can become an automated test.

**Server-side ignorance**

- **ZK-01** — The master password is never transmitted to the server, in any form, on any endpoint. *Assert:* record every request body/header/query on the full unlock + CRUD workflow; the master password string appears in none of them.
- **ZK-02** — The server never stores the master password, in plaintext or in any recoverable form. Only client-derived, non-invertible artefacts (a verifier and the KDF salt/params) may be persisted. *Assert:* dump every table after setup and unlock; the master password appears nowhere.
- **ZK-03** — The server never *validates* the master password's content, strength, or correctness against plaintext. Strength enforcement for the master password happens client-side before derivation; the server enforces only the KDF floor (R-22) and the shape of opaque fields. *Assert:* no server code path branches on a decrypted or plaintext secret value. (Note the deliberate distinction from R-12: **account/login** passwords *are* validated server-side; the **master password** is not, because the server must never see it.)
- **ZK-04** — The server never possesses the unwrapped Vault Key, the recovery key, or any user private key. Wrapped/encrypted forms only. *Assert:* the DB column set contains no column whose contents decrypt without client-held material; a decrypt attempt using only server-side material fails.
- **ZK-05** — All key derivation (Argon2id) and all encryption/decryption of vault secrets occurs client-side via Web Crypto. No server endpoint accepts plaintext to encrypt or returns plaintext it decrypted. *Assert:* no NestJS route handler calls a vault decrypt function; the vault module has no server-side symmetric-decrypt dependency at all.

**Which fields are opaque to the server**

- **ZK-06** — The server treats the following as **opaque byte strings** — stored, length-checked and integrity-checked, never parsed or interpreted: entry secret ciphertext, per-entry IV/nonce, wrapped Entry Keys, the wrapped Vault Key, the wrapped private key, the wrapped recovery blob, and share-grant wrapped keys. The only *non-opaque* crypto-adjacent fields are the KDF salt and `kdfParams` (validated per R-22) and the algorithm/`keyVersion` envelope tags (R-23). *Assert:* a schema test enumerating vault columns and their classification, with the server-side handler for each opaque column doing nothing but pass-through persistence.
- **ZK-07** — Vault-entry *metadata* the server can see must be an explicit, reviewed list (e.g. entry id, owner id, folder id, timestamps, and whichever of title/username/url the product deliberately leaves in the clear). Anything not on that list is encrypted client-side. *Assert:* a documented field-classification table checked into the repo, with a test that fails when a new vault column appears without a classification.

**No leakage through side channels**

- **ZK-08** — No plaintext secret, master password, or key ever appears in an application log, at any log level, in any environment. *Assert:* run the full workflow with log capture and grep the output for the known test secrets; also assert the redaction serialiser is installed (R-27). ([SCRIPT] §3: "Whether the master password appears in logs"; §4: "Plaintext passwords are not written to logs"; §12: "Logs do not contain passwords".)
- **ZK-09** — No plaintext appears in the database, in a cache layer, in a temp file, in a backup, or in an audit-log row. *Assert:* post-workflow scan of DB + Redis + audit table for the test secrets. ([SCRIPT] §4 "Check data in: Database / Local application storage / Cache / Temporary files / Logs / Backup files".)
- **ZK-10** — No plaintext or key material appears in browser storage: `localStorage`, `sessionStorage`, IndexedDB, cookies, or the Cache API. *Assert:* Playwright enumerates all four after unlock and after reveal; none contains the test secret or key bytes. ([SCRIPT] §13.)
- **ZK-11** — No secret appears in a URL, a `Referer` header, a page title, a browser-history entry, or a server access log. *Assert:* reveal/export are POST with `no-store` (R-26); assert `Referrer-Policy: no-referrer`; assert no secret in `document.title` or `location`.
- **ZK-12** — No secret is exposed to browser devtools beyond the minimum necessary: no secret in a global, no secret in a React prop or context that appears in the React DevTools tree, no secret in a hydration payload. *Assert:* R-04 test, plus a check of `__NEXT_DATA__` and RSC flight data for the test secret. ([SCRIPT] §3: "Whether the master password appears in browser/dev tools".)
- **ZK-13** — Key and plaintext lifetime in memory is minimised: plaintext is held only for the duration of the display/copy operation and is dropped on lock, logout, navigation and idle; keys are zeroed and their worker terminated on lock (R-04, R-19). *Assert:* after lock, a page-context probe finds no plaintext in any reachable object. ([SCRIPT] §3: "Whether it is exposed in memory unnecessarily"; §13 "Memory dumps" is a manual item.)
- **ZK-14** — Encryption keys are never hardcoded and never committed. *Assert:* a secret-scanner (gitleaks/trufflehog) gate in CI; R-13 fail-fast config. ([SCRIPT] §4: "Encryption keys are not hardcoded", "Keys are not stored insecurely".)
- **ZK-15** — Crypto hygiene: AES-256-GCM for symmetric, RSA-OAEP-3072 (or better) for key sharing, a **fresh random IV per encryption with no reuse**, a per-derivation random salt of ≥ 16 bytes, no hand-rolled primitives. *Assert:* unit tests that encrypting the same plaintext twice yields different IVs and different ciphertexts; a test that a tampered ciphertext or tag fails authentication rather than returning garbage. (P-02, P-03.)
- **ZK-16** — Cross-tenant isolation is absolute: no request by user A can obtain any ciphertext, wrapped key, or metadata belonging to user B unless an explicit share grant exists. *Assert:* the IDOR matrix test (§5 item 6.x). ([SCRIPT] §5: "Verify that one user can never access another user's vault.")
- **ZK-17** — Zero-knowledge properties must survive failure. An error, timeout, crash, retry, DB outage or offline state must never cause plaintext to be written somewhere durable or the vault to remain unlocked. *Assert:* fault-injection tests around the reveal path; assert lock state after a forced API failure. ([SCRIPT] §17: "Verify that security is not weakened during failures.")

---

## 4. AI isolation requirement

### What the documents say

[SCRIPT] §15 is marked **"AI Restriction – CRITICAL REQUIREMENT"** and is the strongest-worded section in the brief:

> "The Password Manager application must **NOT send sensitive vault data, passwords, master passwords, encryption keys, biometric information, or authentication secrets to any AI service**."
>
> Test all application pages and network requests to verify:
> - "No password data is sent to external AI services"
> - "No master password is sent to AI"
> - "No encryption key is sent to AI"
> - "No vault content is used as AI input"
> - "No hidden AI API calls occur"
> - "No telemetry accidentally contains secrets"
>
> "The Password Manager and all sensitive vault pages must operate independently of AI services."
>
> "If any AI-related integration exists elsewhere in the application, it must be strictly isolated from sensitive password and vault data."

[AUDIT] §3 records the legacy app **passing** this:

> "**No AI/LLM exposure**: grepped both repos for API keys and outbound calls — the app's separate AI-chat feature is architecturally and route-wise disjoint from the password manager; no vault data can reach it."

This is a **preserved property (P-17)**, and it is the one most at risk in this particular rewrite, because the rewrite lives in a directory named `Ai-Stack-change` and the org runs an AI Agent / DB Bot feature. "Architecturally and route-wise disjoint" was achieved in the legacy app partly by accident of separate stacks. In a single unified Next.js + NestJS codebase, disjointness has to be **engineered and enforced**, not inherited.

### The enforceable architectural boundary

- **R-38 — The AI subsystem and the vault subsystem share no data path.**
  Independent NestJS modules with **no import edge in either direction**. The AI module must not import the vault module, its services, its DTOs, its repositories, or its entities; and vice-versa. *Enforcement:* an architecture-fitness test (`dependency-cruiser` or `eslint-plugin-boundaries`) with a rule forbidding `vault/** → ai/**` and `ai/** → vault/**`, failing CI on any violation. This is the single mechanical control that makes the boundary real.

- **R-39 — The AI subsystem's data access is allow-listed at the database level, not the application level.**
  The AI Agent / DB Bot connects with its **own database role** whose grants exclude every vault table (entries, entry keys, vault keys, share grants, folders, groups, TOTP secrets, vault audit rows). A prompt-injection or SQL-generation bug in the bot then cannot reach vault data even if the application-layer check is bypassed — the database refuses. *Assert:* an integration test running a `SELECT` against each vault table as the AI role and asserting a permission error. This directly answers [SCRIPT] §12's least-privilege requirement as well.

- **R-40 — Vault plaintext, master password, key material and TOTP secrets are never AI input, ever, under any feature flag.**
  No vault field — plaintext *or ciphertext* — may be placed in a prompt, a tool-call argument, a retrieval index, an embedding, a fine-tuning set, or an evaluation fixture. Ciphertext is included in the ban deliberately: it is not decryptable by the model, but shipping it to a third party is an unnecessary disclosure of key-wrapping structure and volume metadata, and [SCRIPT] §15 says "No vault content is used as AI input" without qualification. *Assert:* an outbound-request test that runs the full vault workflow with a network interceptor and asserts **zero requests to any AI/LLM host**; plus the module-boundary test (R-38).

- **R-41 — No AI code is loaded on a vault page, and no vault code on an AI page.**
  Vault routes must not ship an AI SDK, chat widget, telemetry SDK, analytics script, or session-replay script in their JS bundle. *Assert:* a bundle-analysis gate asserting the vault route's client bundle contains no AI/analytics/replay package; a Playwright assertion that a vault page issues no third-party request. This closes the "hidden AI API calls" item, and note it is also an XSS-surface reduction: every third-party script on an unlocked vault page is another route to R-04's key handles.

- **R-42 — Telemetry and error reporting from vault pages are scrubbed or absent.**
  Session replay and DOM-capturing error reporters are **prohibited** on vault routes. If error reporting exists, it sends an error code plus a correlation id only — never a stack local, request body, DOM snapshot, or breadcrumb containing a field value. *Assert:* the reporter is not initialised on vault routes; a unit test on the scrub function; the outbound-request test of R-40. ([SCRIPT] §15: "No telemetry accidentally contains secrets"; §13: "Crash reports".)

- **R-43 — The boundary is documented and reviewed.**
  A one-page data-flow diagram showing that no arrow crosses from the vault to the AI subsystem is checked into `docs/`, and any PR touching either module requires review against it. *(This is the one non-automatable item in this section; it is the human backstop for R-38.)*

---

## 5. Acceptance test script, converted

This is [SCRIPT] converted into a numbered acceptance checklist for the web rewrite. **Every item from the original is preserved.** Numbering follows the original's section order so items can be traced back.

**Legend**
- **WEB** — applies to the Next.js + NestJS web app; must be executed.
- **SKIP-DESKTOP** — Electron/IPC/native-biometric-only; not applicable, per the [AUDIT] correction. Not deleted, so the reason for skipping stays on the record.
- **WEB (analogue)** — an item added to preserve the *intent* of a SKIP-DESKTOP item at the equivalent web boundary. These are additions, not replacements.
- Refs point to the finding/requirement this item verifies.

### 1. Application Discovery
*Original instruction: "Create a complete list of all modules before testing."*

| # | Item | Applies | Ref |
|---|---|---|---|
| 1.1 | Identify frontend technology | WEB | |
| 1.2 | Identify backend technology | WEB | |
| 1.3 | Identify Electron/Desktop architecture | SKIP-DESKTOP | [AUDIT] correction |
| 1.4 | Enumerate all APIs | WEB | |
| 1.5 | Identify the authentication system | WEB | |
| 1.6 | Identify the database | WEB | |
| 1.7 | Identify local storage usage | WEB | ZK-10 |
| 1.8 | Identify encryption mechanisms | WEB | ZK-15 |
| 1.9 | Identify key management | WEB | R-04 |
| 1.10 | Identify fingerprint/biometric integration | SKIP-DESKTOP | see 10.x |
| 1.11 | Identify the password generation module | WEB | R-25 |
| 1.12 | Identify the password vault | WEB | |
| 1.13 | Identify session management | WEB | |
| 1.14 | Identify import/export functionality | WEB | ZK-09 |
| 1.15 | Identify browser integration, if available | WEB | |
| 1.16 | Identify sync functionality, if available | WEB | |
| 1.17 | Produce the complete module list before testing begins | WEB | |
| 1.18 | **(analogue, new)** Enumerate all AI/LLM integration points and confirm none touch the vault | WEB (analogue) | R-38…R-42 |

### 2. End-to-End Functional Testing — Registration

| # | Item | Applies | Ref |
|---|---|---|---|
| 2.1 | Valid registration succeeds | WEB | |
| 2.2 | Invalid email is rejected | WEB | |
| 2.3 | Weak password is rejected **server-side** | WEB | V-F5 / R-12 |
| 2.4 | Strong password is accepted | WEB | R-12 |
| 2.5 | Duplicate account registration is handled (and does not leak whether the email exists) | WEB | R-33 |
| 2.6 | Empty fields are rejected | WEB | |
| 2.7 | Very long inputs are rejected/bounded (no DoS, no truncation-based bypass) | WEB | R-05 |
| 2.8 | Special characters handled — **including markup-bearing display names, which must render as inert text** | WEB | **V-XSS-01 / R-01, R-05** |
| 2.9 | Unicode characters handled (incl. RTL override, zero-width, combining marks, homoglyphs in display names) | WEB | R-05 |
| 2.10 | Error messages are clear and generic | WEB | R-16 |
| 2.11 | Account verification flow works and cannot be skipped | WEB | |
| 2.12 | No sensitive information is exposed in any error message | WEB | V-F9 / R-16 |

### 2b. Login

| # | Item | Applies | Ref |
|---|---|---|---|
| 2.13 | Correct username and password → success | WEB | |
| 2.14 | Incorrect password → generic failure | WEB | R-33 |
| 2.15 | Incorrect username → **identical** response to 2.14 (no enumeration) | WEB | R-33 |
| 2.16 | Multiple failed login attempts are counted | WEB | **V-F2 / R-08** |
| 2.17 | Brute-force protection is active | WEB | **V-F2 / R-08** |
| 2.18 | Account lockout behaves correctly (and cannot be reset by changing IP) | WEB | **V-F2 / R-08** |
| 2.19 | Rate limiting is enforced per account and per IP | WEB | **V-F2 / R-08** |
| 2.20 | Session creation is correct (cookie flags, rotation on login) | WEB | R-45 |
| 2.21 | Session expiration is enforced server-side | WEB | R-18 |
| 2.22 | Logout works and revokes server-side | WEB | **V-F11 / R-18** |
| 2.23 | Login after logout works | WEB | |
| 2.24 | Login from multiple devices behaves as designed | WEB | |
| 2.25 | Authentication cannot be bypassed (no unauthenticated route reaches vault data) | WEB | **V-F1 / R-07** |

### 3. Master Password Security

| # | Item | Applies | Ref |
|---|---|---|---|
| 3.1 | Master password strength requirements enforced | WEB | R-12 |
| 3.2 | Weak master passwords prevented | WEB | R-12 |
| 3.3 | Password hashing verified (account password: memory-hard algorithm, per-user salt) | WEB | |
| 3.4 | Salt usage verified — unique, random, ≥ 16 bytes, never reused | WEB | ZK-15 |
| 3.5 | Key derivation verified — Argon2id, params at/above the floor, **validated server-side** | WEB | **V-F15 / R-22** |
| 3.6 | Password reset security — reset cannot be used to bypass the vault or recover vault plaintext | WEB | R-18 |
| 3.7 | Password recovery process — recovery key path is zero-knowledge; losing the master password without the recovery key means unrecoverable data, and the UI says so | WEB | ZK-04 |
| 3.8 | Master password is never stored in plaintext anywhere | WEB | **ZK-02** |
| 3.9 | Master password never appears in logs | WEB | **ZK-08** |
| 3.10 | Master password never appears in browser/dev tools (globals, storage, hydration payload, React tree) | WEB | **ZK-12 / R-04** |
| 3.11 | Master password is not exposed in memory unnecessarily — dropped immediately after derivation | WEB | **ZK-13 / R-04** |
| 3.12 | Sensitive secrets are never exposed to unauthorized users | WEB | ZK-16 |
| 3.13 | **(analogue, new)** Master password is never transmitted to the server on any endpoint | WEB (analogue) | **ZK-01** |

### 4. Encryption Security Testing

| # | Item | Applies | Ref |
|---|---|---|---|
| 4.1 | Password vault encryption verified end-to-end | WEB | ZK-05 |
| 4.2 | Encryption algorithm usage correct (AES-256-GCM; RSA-OAEP-3072 for sharing) | WEB | ZK-15 |
| 4.3 | Key derivation process correct | WEB | R-22 |
| 4.4 | Unique salts per derivation | WEB | ZK-15 |
| 4.5 | IVs/nonces unique per operation, never reused | WEB | ZK-15 |
| 4.6 | Encryption keys are not hardcoded | WEB | **ZK-14** |
| 4.7 | Keys are not stored insecurely | WEB | **R-04 / ZK-10** |
| 4.8 | Plaintext passwords are not written to logs | WEB | **ZK-08** |
| 4.9 | Plaintext passwords are not stored in local files | WEB | ZK-09 |
| 4.10 | Inspect the **database** for plaintext | WEB | ZK-09 |
| 4.11 | Inspect **local application storage** (localStorage/sessionStorage/IndexedDB/cookies/Cache API) | WEB | **ZK-10** |
| 4.12 | Inspect **cache** (Redis, HTTP cache, Next.js data/route cache, RSC cache) | WEB | ZK-09 / R-26 |
| 4.13 | Inspect **temporary files** (upload temp, export temp, `/tmp`) | WEB | ZK-09 |
| 4.14 | Inspect **logs** (app, access, DB, container) | WEB | ZK-08 |
| 4.15 | Inspect **backup files** (DB dumps, snapshots) | WEB | ZK-09 |
| 4.16 | Confirm vault data remains protected at rest — a full DB dump is useless without each user's master password | WEB | **P-01 / ZK-04** |
| 4.17 | **(analogue, new)** Tampered ciphertext/auth tag fails authentication rather than returning garbage | WEB (analogue) | ZK-15 |
| 4.18 | **(analogue, new)** Ciphertext carries an algorithm + `keyVersion` envelope and rotation is possible | WEB (analogue) | V-F16 / R-23 |

### 5. Password Vault Testing

| # | Item | Applies | Ref |
|---|---|---|---|
| 5.1 | Add password | WEB | |
| 5.2 | View/reveal password (POST, `no-store`, audited, re-auth-gated) | WEB | V-F19 / R-26, R-19 |
| 5.3 | Copy password | WEB | 14.x / R-31 |
| 5.4 | Edit password | WEB | |
| 5.5 | Delete password | WEB | |
| 5.6 | Search passwords (search must not require server-side plaintext) | WEB | ZK-07 |
| 5.7 | Categorize passwords / folders | WEB | |
| 5.8 | Favorite passwords | WEB | |
| 5.9 | Edge: empty password | WEB | |
| 5.10 | Edge: extremely long password | WEB | 17.x |
| 5.11 | Edge: special characters (incl. markup — must round-trip and render inert) | WEB | **R-01** |
| 5.12 | Edge: Unicode (emoji, RTL, zero-width, NFC/NFD normalisation round-trip) | WEB | |
| 5.13 | Edge: duplicate entries | WEB | |
| 5.14 | Edge: simultaneous edits (optimistic-concurrency / version conflict handled, no silent overwrite, no ciphertext corruption) | WEB | ZK-17 |
| 5.15 | One user can never access another user's vault | WEB | **ZK-16** |
| 5.16 | **(analogue, new)** History and purge operations respect the same ownership tiers and are audited | WEB (analogue) | P-07, P-10 |
| 5.17 | **(analogue, new)** Sharing: per-user, per-group, and share-link flows are zero-knowledge and enumeration-resistant | WEB (analogue) | P-09 / R-33 |
| 5.18 | **(analogue, new)** Share revocation rotates the secret; a previously unwrapped key no longer decrypts current ciphertext | WEB (analogue) | **V-F21 / R-28** |

### 6. Authorization and Access Control

| # | Item | Applies | Ref |
|---|---|---|---|
| 6.1 | User A cannot access User B's passwords | WEB | **ZK-16** |
| 6.2 | IDs cannot be manipulated to access other records (UUID PKs; ownership checked per operation) | WEB | P-07, P-08 |
| 6.3 | APIs validate ownership on every operation, independently of role | WEB | **R-11** |
| 6.4 | Unauthorized API requests are rejected | WEB | R-07 |
| 6.5 | Expired sessions cannot access data | WEB | R-18 |
| 6.6 | Logged-out users cannot access protected pages | WEB | R-18 |
| 6.7 | Broken access control — full route × role × ownership matrix test | WEB | **V-F1, V-F4 / R-07, R-10** |
| 6.8 | IDOR-style issues — swap every id in every vault request for another tenant's id | WEB | ZK-16 |
| 6.9 | Missing authorization checks — every route has an explicit policy; default is deny | WEB | **R-07, R-10** |
| 6.10 | Privilege escalation | WEB | **V-F1 / R-07** |
| 6.11 | **(analogue, new)** A JWT with an unknown, empty, null, or non-string role is **rejected**, never coerced to a privileged role | WEB (analogue) | **V-F1 / R-07** — the exact legacy Critical |
| 6.12 | **(analogue, new)** Guest-equivalent low-privilege roles receive 403 on every vault route | WEB (analogue) | **V-F1 / R-07** |

### 7. Session Security

| # | Item | Applies | Ref |
|---|---|---|---|
| 7.1 | Session creation correct | WEB | R-45 |
| 7.2 | Session expiration enforced | WEB | R-18 |
| 7.3 | Logout invalidation is server-side | WEB | **V-F11 / R-18** |
| 7.4 | Multiple sessions behave as designed and are individually revocable | WEB | |
| 7.5 | Idle timeout enforced | WEB | **V-F12 / R-19** |
| 7.6 | Application (vault) lock timeout enforced | WEB | **V-F12 / R-19** |
| 7.7 | Reauthentication required for sensitive actions (reveal, export, share, disable MFA, rotate master password) | WEB | **R-19** |
| 7.8 | Sessions are securely managed (cookie flags, rotation on privilege change) | WEB | R-45 |
| 7.9 | Sensitive data is inaccessible after logout | WEB | ZK-13 |
| 7.10 | The vault automatically locks after the configured inactivity period | WEB | **R-19** |
| 7.11 | **(analogue, new)** Vault locks on tab-blur/`visibilitychange` past the grace period, and on `pagehide`/`beforeunload` — the specific legacy gap | WEB (analogue) | **V-F12 / R-19** |
| 7.12 | **(analogue, new)** Vault MFA (TOTP) verify/disable is rate-limited and locks out | WEB (analogue) | **V-F3 / R-09** |

### 8. Electron/Desktop Application Security
*Per the [AUDIT] correction, the target is a web app with no Electron shell. All original items are retained as SKIP-DESKTOP; web analogues are added where the intent transfers.*

| # | Item | Applies | Ref |
|---|---|---|---|
| 8.1 | Context isolation | SKIP-DESKTOP | |
| 8.2 | Node integration settings | SKIP-DESKTOP | |
| 8.3 | Preload script security | SKIP-DESKTOP | |
| 8.4 | IPC communication security | SKIP-DESKTOP | see 9.x |
| 8.5 | Renderer process permissions | SKIP-DESKTOP | |
| 8.6 | File system access | SKIP-DESKTOP | |
| 8.7 | Remote content loading | SKIP-DESKTOP | |
| 8.8 | Navigation restrictions | SKIP-DESKTOP | |
| 8.9 | External link handling | SKIP-DESKTOP | |
| 8.10 | Untrusted content cannot gain system-level access | SKIP-DESKTOP | |
| 8.11 | Review all Electron configuration for secure defaults | SKIP-DESKTOP | |
| 8.12 | **(analogue)** *Isolation:* the vault runs on its own origin/route group with the strict CSP as default, and no third-party script is loaded on it | WEB (analogue) | R-02, R-41 |
| 8.13 | **(analogue)** *Remote content:* CSP restricts `img-src`/`font-src`/`connect-src`/`frame-src`; no remote content is loaded into a vault page; `frame-ancestors 'none'` | WEB (analogue) | R-02 |
| 8.14 | **(analogue)** *Navigation restrictions:* no open-redirect — every redirect target is validated against an allow-list; `form-action 'self'`, `base-uri 'none'` | WEB (analogue) | R-02, R-49 |
| 8.15 | **(analogue)** *External links:* all external anchors use `rel="noopener noreferrer"` and `target="_blank"` never receives a user-controlled href | WEB (analogue) | R-49 |
| 8.16 | **(analogue)** *Filesystem access:* server has no route that reads/writes a client-supplied path; export/import writes only to a bounded, non-web-served location; no path traversal | WEB (analogue) | R-49 |
| 8.17 | **(analogue)** *Renderer permissions:* `Permissions-Policy` denies camera, microphone, geolocation, USB, `clipboard-read`, and everything else not needed | WEB (analogue) | R-06a, R-46 |
| 8.18 | **(analogue)** *Secure defaults review:* the equivalent config review is the `next.config` + middleware + NestJS bootstrap security review (headers, CSP, cookies, CORS) | WEB (analogue) | §6 |

### 9. IPC Security Testing
*Native IPC does not exist. But the *intent* — "every privileged channel reachable from untrusted code is explicitly validated" — transfers exactly to Next.js server actions / route handlers and the NestJS API, which are the rewrite's privileged boundaries reachable from the client.*

| # | Item | Applies | Ref |
|---|---|---|---|
| 9.1 | Renderer↔Main communication analysed | SKIP-DESKTOP | |
| 9.2 | Preload script channels analysed | SKIP-DESKTOP | |
| 9.3 | Every IPC channel is explicitly validated | SKIP-DESKTOP | see 9.7 |
| 9.4 | Untrusted input cannot execute privileged operations | SKIP-DESKTOP | see 9.8 |
| 9.5 | File system operations restricted | SKIP-DESKTOP | see 8.16 |
| 9.6 | Sensitive operations require authorization | SKIP-DESKTOP | see 9.9 |
| 9.7 | **(analogue)** Every Next.js server action and route handler validates its input with a schema before use — no implicit trust in a client-supplied argument | WEB (analogue) | R-47 |
| 9.8 | **(analogue)** Every server action re-checks authentication **and** authorization itself; being reachable only from a "protected" page is not a control | WEB (analogue) | R-47 |
| 9.9 | **(analogue)** No server action or route handler returns a token, secret, key, or internal identifier to the client | WEB (analogue) | **R-20** |
| 9.10 | **(analogue)** IPC-equivalent abuse: no server action can be replayed cross-origin (CSRF/origin check), and none can be invoked to bypass the lock, MFA, or ownership tier | WEB (analogue) | R-37, R-47 |
| 9.11 | **(analogue)** The client↔crypto-worker message boundary (R-04) accepts only bounded *operations*, never "return the key", and is rate-limited and audited | WEB (analogue) | **R-04** |

### 10. Biometric/Fingerprint Authentication
*Not implemented in the legacy web app ([AUDIT]: "no biometric/fingerprint integration anywhere in the code") and out of scope for the rewrite unless WebAuthn/passkeys are deliberately added. Items retained; the note preserves the original's key privacy requirement should WebAuthn ever be adopted.*

| # | Item | Applies | Ref |
|---|---|---|---|
| 10.1 | Valid fingerprint authentication | SKIP-DESKTOP | |
| 10.2 | Failed fingerprint authentication | SKIP-DESKTOP | |
| 10.3 | Cancelled authentication | SKIP-DESKTOP | |
| 10.4 | Repeated failures | SKIP-DESKTOP | |
| 10.5 | Fallback authentication | SKIP-DESKTOP | |
| 10.6 | Application behavior after biometric failure | SKIP-DESKTOP | |
| 10.7 | Biometric data is never exposed to the application; handled only via OS/hardware security mechanisms | SKIP-DESKTOP | |
| 10.8 | **(analogue, conditional)** *If* WebAuthn/passkeys are added: the credential is an **authentication** factor only and must never be treated as, or used to derive, the master password or the vault key — biometric material never leaves the authenticator, and unlocking still requires the user's own key material | WEB (analogue) | ZK-01, R-04 |

### 11. API Security Testing

| # | Item | Applies | Ref |
|---|---|---|---|
| 11.1 | Every endpoint enforces authentication requirements | WEB | R-07 |
| 11.2 | Every endpoint enforces authorization requirements | WEB | R-10, R-11 |
| 11.3 | Input validation on every endpoint | WEB | R-47 |
| 11.4 | Rate limiting on every endpoint | WEB | **V-F2, V-F3 / R-08, R-09** |
| 11.5 | Error handling is generic outward | WEB | **V-F9 / R-16** |
| 11.6 | No sensitive data exposure in responses | WEB | **P-11 / R-35** |
| 11.7 | Broken access control | WEB | **V-F1 / R-07** |
| 11.8 | Injection vulnerabilities (SQL, NoSQL, command, template, ORM operator) | WEB | **P-12 / R-36** |
| 11.9 | Missing authentication (route inventory vs. guard coverage; default-deny) | WEB | R-07 |
| 11.10 | Excessive data exposure (allow-list serialisation, no entity leakage) | WEB | **R-35** |
| 11.11 | Insecure direct object references | WEB | ZK-16 |
| 11.12 | Weak rate limiting (distributed store, not per-instance memory) | WEB | R-08 |
| 11.13 | Improper error messages | WEB | R-16 |
| 11.14 | No destructive attacks against production systems | WEB | *procedural* |
| 11.15 | **(analogue, new)** API documentation (Swagger/OpenAPI) is disabled or authenticated in production | WEB (analogue) | **V-F10 / R-17** |
| 11.16 | **(analogue, new)** Mass-assignment: extra/unexpected body fields are stripped, not persisted (`whitelist` + `forbidNonWhitelisted`) | WEB (analogue) | R-47 |

### 12. Database Security

| # | Item | Applies | Ref |
|---|---|---|---|
| 12.1 | Password vault data is encrypted | WEB | ZK-04 |
| 12.2 | Secrets are not stored in plaintext | WEB | ZK-02, ZK-09 |
| 12.3 | Database credentials are protected (no default, fail-fast, from a secret store) | WEB | **V-F6 / R-13** |
| 12.4 | Least-privilege database access is used | WEB | **R-39** |
| 12.5 | Sensitive data is not exposed through errors | WEB | **V-F9 / R-16** |
| 12.6 | Backups are protected (encrypted at rest, access-controlled, retention defined) | WEB | ZK-09 |
| 12.7 | Logs do not contain passwords | WEB | **ZK-08 / R-27** |
| 12.8 | Input validation and database query safety | WEB | R-36, R-47 |
| 12.9 | **(analogue, new)** The AI Agent / DB Bot database role has **no grant** on any vault table | WEB (analogue) | **R-39** |
| 12.10 | **(analogue, new)** Every vault table uses UUID primary keys; no sequential id appears in a vault URL or payload | WEB (analogue) | **P-08 / R-32** |

### 13. Local Storage and Privacy Testing

| # | Item | Applies | Ref |
|---|---|---|---|
| 13.1 | No sensitive data in local storage (localStorage/sessionStorage/IndexedDB/cookies/Cache API) | WEB | **ZK-10** |
| 13.2 | No sensitive data in cache | WEB | ZK-09, R-26 |
| 13.3 | No sensitive data in temporary files | WEB | ZK-09 |
| 13.4 | No sensitive data in application logs | WEB | **ZK-08** |
| 13.5 | No sensitive data in crash reports | WEB | **R-42** |
| 13.6 | Clipboard does not retain secrets longer than necessary | WEB | 14.x / R-31 |
| 13.7 | Memory dumps do not contain avoidable secret material | WEB *(manual)* | ZK-13 |
| 13.8 | No sensitive data in backup files | WEB | ZK-09 |
| 13.9 | After logout **and** after vault lock, sensitive information is no longer accessible | WEB | **ZK-13 / R-19** |
| 13.10 | **(analogue, new)** No secret in `document.title`, the URL, browser history, the back/forward cache, or a `Referer` header | WEB (analogue) | **ZK-11** |
| 13.11 | **(analogue, new)** No secret or key in any global, React prop/context, or hydration/RSC payload | WEB (analogue) | **ZK-12 / R-04, R-20** |
| 13.12 | **(analogue, new)** Vault crypto paths emit zero `console.*` output in a production build | WEB (analogue) | **V-F14 / R-21** |

### 14. Clipboard Security

| # | Item | Applies | Ref |
|---|---|---|---|
| 14.1 | Password copying works | WEB | |
| 14.2 | Clipboard clearing behavior verified | WEB | **R-31** |
| 14.3 | Automatic timeout verified (≤ 45 s, preserving the legacy behaviour) | WEB | **P-06 / R-31** |
| 14.4 | Application crash during copy does not leave the secret on the clipboard indefinitely | WEB | R-31 |
| 14.5 | Logout after copy clears the clipboard | WEB | R-31 |
| 14.6 | Passwords are not left on the clipboard longer than necessary | WEB | R-31 |
| 14.7 | **(analogue, new)** The generation-counter guard prevents clearing a newer, unrelated clipboard value | WEB (analogue) | **P-06 / R-31** |
| 14.8 | **(analogue, new)** The app never requests `clipboard-read`; `Permissions-Policy` denies it | WEB (analogue) | **R-06a** |

### 15. AI Restriction — CRITICAL REQUIREMENT

| # | Item | Applies | Ref |
|---|---|---|---|
| 15.1 | No password data is sent to external AI services | WEB | **R-40** |
| 15.2 | No master password is sent to AI | WEB | **R-40** |
| 15.3 | No encryption key is sent to AI | WEB | **R-40** |
| 15.4 | No vault content is used as AI input (plaintext **or** ciphertext) | WEB | **R-40** |
| 15.5 | No hidden AI API calls occur (all pages, all network requests) | WEB | **R-40, R-41** |
| 15.6 | No telemetry accidentally contains secrets | WEB | **R-42** |
| 15.7 | The password manager and all vault pages operate independently of AI services | WEB | **R-38, R-41** |
| 15.8 | Any AI integration elsewhere is strictly isolated from vault data | WEB | **R-38, R-39** |
| 15.9 | **(analogue, new)** No import edge exists between the vault module and the AI module, in either direction (architecture-fitness test) | WEB (analogue) | **R-38** |
| 15.10 | **(analogue, new)** The AI/DB-Bot database role is denied on every vault table at the DB level | WEB (analogue) | **R-39** |
| 15.11 | **(analogue, new)** No biometric information is sent to AI *(retained from the original's wording; vacuous while no biometrics exist)* | WEB (analogue) | R-40 |

### 16. User Experience Testing

| # | Item | Applies | Ref |
|---|---|---|---|
| 16.1 | Easy registration | WEB | |
| 16.2 | Easy login | WEB | |
| 16.3 | Clear error messages (clear without being informative to an attacker) | WEB | R-16, R-33 |
| 16.4 | Password visibility controls work as expected | WEB | |
| 16.5 | Easy password generation | WEB | R-25 |
| 16.6 | Easy password search | WEB | |
| 16.7 | Clear security warnings (esp. unrecoverable-data warning, and revocation-does-not-un-know warning) | WEB | R-28, ZK-04 |
| 16.8 | Simple vault management | WEB | |
| 16.9 | Accessibility (WCAG 2.1 AA; secrets not announced by a screen reader unless revealed) | WEB | |
| 16.10 | Responsive UI | WEB | |
| 16.11 | Keyboard navigation (incl. reveal/copy reachable by keyboard, and focus not trapped in a locked state) | WEB | |
| 16.12 | Dark/light mode if available | WEB | |
| 16.13 | Identify confusing workflows and recommend improvements | WEB *(manual)* | |
| 16.14 | *Note:* [AUDIT] scored UX **"Not assessed — this was a static code audit; no live UI/browser walkthrough was performed — recommend a separate live UX pass."* **This pass is owed and must happen in the rewrite.** | WEB *(manual)* | |

### 17. Edge Case Testing

| # | Item | Applies | Ref |
|---|---|---|---|
| 17.1 | Internet disconnected | WEB | ZK-17 |
| 17.2 | Application crashes (server 500, client error boundary) | WEB | ZK-17, R-42 |
| 17.3 | System restart | WEB | |
| 17.4 | Forced application close (tab kill) → vault locked, clipboard cleared | WEB | R-19, R-31 |
| 17.5 | Database temporarily unavailable | WEB | ZK-17 |
| 17.6 | API unavailable | WEB | ZK-17 |
| 17.7 | Slow network (no timeout that leaves the vault unlocked or plaintext in a retry buffer) | WEB | ZK-17 |
| 17.8 | Multiple application windows *(web: multiple tabs — lock state must be consistent across tabs)* | WEB | R-19 |
| 17.9 | Concurrent sessions | WEB | 7.4 |
| 17.10 | Very large vault (pagination, no memory blowup, no timeout that degrades a security check) | WEB | |
| 17.11 | Extremely long passwords | WEB | 5.10 |
| 17.12 | Security is not weakened during any of the above failures | WEB | **ZK-17** |

### 18. Security Regression Testing *(process items)*

| # | Item | Applies |
|---|---|---|
| 18.1 | Document each issue | WEB *(process)* |
| 18.2 | Assign severity using the scale 🔴 Critical / 🟠 High / 🟡 Medium / 🟢 Low / 🔵 Informational | WEB *(process)* |
| 18.3 | Explain the security impact | WEB *(process)* |
| 18.4 | Recommend a fix | WEB *(process)* |
| 18.5 | Retest after the fix | WEB *(process)* |
| 18.6 | **(analogue, new)** Every fixed finding gets a permanent regression test, so the fix cannot silently revert | WEB *(process)* |

### 19. Final Security Report *(deliverable items)*

| # | Item | Applies |
|---|---|---|
| 19.1 | List every module tested | WEB |
| 19.2 | For each finding: name, severity, affected module, description, security impact, evidence, recommended remediation, retest status | WEB |
| 19.3 | Score Authentication /10 | WEB |
| 19.4 | Score Authorization /10 | WEB |
| 19.5 | Score Encryption /10 | WEB |
| 19.6 | Score API Security /10 | WEB |
| 19.7 | Score Electron Security /10 | SKIP-DESKTOP *(record as N/A, as [AUDIT] did)* |
| 19.8 | Score Database Security /10 | WEB |
| 19.9 | Score Local Storage Security /10 | WEB |
| 19.10 | Score Session Security /10 | WEB |
| 19.11 | Score Privacy /10 | WEB |
| 19.12 | Score User Experience /10 *(must actually be assessed this time — see 16.14)* | WEB |
| 19.13 | Overall Security Score X/10 | WEB |
| 19.14 | Final verdict: ✅ Ready for production / ⚠️ Ready with required fixes / ❌ Not secure enough for production | WEB |

### Final rules *(carried over verbatim in intent)*

| # | Rule | Applies |
|---|---|---|
| FR.1 | Test every module end-to-end | WEB |
| FR.2 | Do not test only the happy path | WEB |
| FR.3 | Look for security weaknesses and logical loopholes | WEB |
| FR.4 | Validate every authentication and authorization boundary | WEB |
| FR.5 | Prioritize protection of passwords, vault data, encryption keys, and master passwords | WEB |
| FR.6 | Never expose real credentials in reports | WEB |
| FR.7 | Do not perform destructive testing against production | WEB |
| FR.8 | Clearly separate confirmed vulnerabilities from theoretical risks | WEB |
| FR.9 | Provide actionable remediation for every confirmed issue | WEB |
| FR.10 | Answer the governing question: **"Can this Password Manager be safely used to store highly sensitive credentials?"** | WEB |

### Release gate

The rewrite does not ship until, at minimum, the items that map to the legacy **Critical** and **High** findings pass: **6.11, 6.12** (V-F1), **2.8, 5.11, 13.11** (V-XSS-01), **2.16–2.19** (V-F2), **7.12** (V-F3). [AUDIT] §5 called F1 a "release blocker"; V-XSS-01 is at least equal to it, since it yields plaintext directly.

---

## 6. Hardening requirements for the new stack (Next.js + NestJS)

### 6.1 CSP header

Emitted from Next.js middleware with a fresh per-request nonce, applied to **every** route by default (the legacy app applied the strict policy only to `/password-manager*` — P-14 becomes the global default):

```
default-src 'none';
script-src 'self' 'nonce-{NONCE}' 'strict-dynamic';
script-src-attr 'none';
style-src 'self' 'nonce-{NONCE}';
style-src-attr 'none';
img-src 'self' data:;
font-src 'self';
connect-src 'self' https://api.example.internal;
form-action 'self';
frame-src 'none';
frame-ancestors 'none';
base-uri 'none';
object-src 'none';
manifest-src 'self';
worker-src 'self';
media-src 'none';
require-trusted-types-for 'script';
trusted-types default nextjs;
upgrade-insecure-requests;
report-uri /api/csp-report; report-to csp-endpoint
```

Non-negotiable points:
- **`script-src-attr 'none'`** — the exact directive whose `'unsafe-inline'` value in `SecurityHeaders.php:59` enabled V-XSS-01. Nonce-locking `<script>` elements alone is not sufficient.
- **No `'unsafe-inline'` and no `'unsafe-eval'` in `script-src` in production.** `'unsafe-eval'` may be needed in dev only; gate it on `NODE_ENV` and assert its absence in a production header test.
- **`require-trusted-types-for 'script'`** is what turns R-01 from a lint rule into browser-enforced behaviour: an unsafe DOM sink throws instead of executing.
- `style-src` with a nonce rather than `'unsafe-inline'`. If a dependency forces inline styles, that is a **tracked exception with a ticket**, never a silent relaxation — and note that `style-src` relaxation does not enable script execution, so it is a strictly lower-risk exception than any `script-src` one.
- Roll out in `Content-Security-Policy-Report-Only` first, fix reports, then enforce. Ship enforcing.
- **Do not treat `connect-src` as an exfiltration control.** [POC] §2.4 is explicit that top-level navigation bypasses it. CSP prevents execution; R-04 is what protects the key when execution happens anyway.

### 6.2 Other security headers

| Header | Value | Ref |
|---|---|---|
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains; preload` | **V-F17 / R-24** |
| `X-Content-Type-Options` | `nosniff` | |
| `Referrer-Policy` | `no-referrer` | ZK-11 |
| `X-Frame-Options` | `DENY` (belt-and-braces with `frame-ancestors`) | |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), usb=(), payment=(), clipboard-read=(), display-capture=(), idle-detection=(), serial=(), hid=()` | **R-06a, R-46** |
| `Cross-Origin-Opener-Policy` | `same-origin` | R-46 |
| `Cross-Origin-Embedder-Policy` | `require-corp` | R-46 |
| `Cross-Origin-Resource-Policy` | `same-origin` | R-46 |
| `Cache-Control` on every authenticated/vault response | `no-store, no-cache, must-revalidate, private` (+ `Pragma: no-cache`) | **V-F19 / R-26** |
| `X-Powered-By` / `Server` | removed / minimised | |
| `Clear-Site-Data` on logout | `"cache", "cookies", "storage"` | R-18, ZK-13 |

**R-46** is the collective requirement: headers are set in **one** place (Next.js middleware for pages, a global NestJS interceptor/`helmet` config for the API), asserted by a snapshot test, so a header cannot be lost by a route-level change.

### 6.3 Cookies

**R-45:**
- Session/refresh cookies: `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=<short>`, with the **`__Host-` prefix** (which forces `Secure`, `Path=/`, and no `Domain` — a browser-enforced guarantee rather than a convention).
- `SameSite=Strict` for the vault-session cookie specifically, if no cross-site entry flow requires Lax.
- **No `Domain` attribute** — never widen a cookie to sibling subdomains.
- Access token TTL ≤ 15 min; refresh token TTL ≤ 7 days with **rotation on every use** and reuse-detection (a replayed refresh token invalidates the whole family).
- **No token in `localStorage`, `sessionStorage`, or any JS-readable cookie** — R-20.
- Session id rotates on login, on privilege change, and on master-password change.
- CSRF token cookie is the one intentionally non-`HttpOnly` cookie (double-submit pattern) and contains no authentication value.

### 6.4 CORS

**R-48:** NestJS `enableCors` with an **explicit origin allow-list** read from validated config — never `origin: true`, never `origin: '*'`, never a reflected `Origin`, never a regex that a lookalike domain can satisfy. `credentials: true` only alongside the explicit allow-list. Methods and headers are allow-listed, not wildcarded. `maxAge` set to reduce preflights. Testable: a request with a foreign `Origin` receives no `Access-Control-Allow-Origin` header.

### 6.5 CSRF

**R-37:** Preserve P-15. Cookie-based auth means CSRF protection is mandatory on every state-changing route: `csrf-csrf`-style double-submit or signed synchroniser token, **plus** an `Origin`/`Sec-Fetch-Site` check as defence in depth. Next.js server actions get the same treatment — being a server action is not a CSRF control. Testable: every mutating route rejects a request with a missing/invalid token and a foreign `Origin`.

### 6.6 Rate limits

**R-08/R-09**, with a Redis-backed store so limits hold across instances and restarts:

| Surface | Limit |
|---|---|
| `POST /auth/login` | 5 failures / account / 15 min → exponential backoff → lockout; 20 req/min/IP ceiling |
| `POST /auth/signup` | 5 / hour / IP, plus email verification |
| Password reset request | 3 / hour / account, 10 / hour / IP; identical response whether or not the account exists |
| `POST /auth/refresh` | 30 / hour / session family; reuse-detection revokes the family |
| Vault MFA verify / confirm / **disable** | 5 failures / user → lock verification ≥ 15 min; audit + alert |
| `POST /vault/entries/:id/reveal` | 30 / min / user; anomaly alert on bulk reveal |
| Vault export | 3 / hour / user; always re-auth; always audited |
| User/recipient search (R-06) | 30 / min / user; minimum query length; capped result set |
| Share-link redemption | 10 / hour / IP; identical response for wrong-recipient and nonexistent (P-09) |
| Global API default | a conservative per-IP ceiling applied by a **global guard**, so a new route is limited before anyone remembers to limit it |

### 6.7 Session and idle timeout

**R-19 / R-18:**
- Server: absolute session lifetime ≤ 12 h; access token ≤ 15 min; refresh rotation on use; **logout revokes server-side** via a `sessionEpoch`/`tokenVersion` bump checked on every verification.
- Client vault lock triggers: idle ≥ 5 min (configurable down, not up); `visibilitychange` to hidden for > 60 s; `pagehide`; `beforeunload`; explicit lock; logout; any 401 from the API.
- Lock zeroes key handles and terminates the crypto worker (R-04).
- Lock state is shared across tabs via `BroadcastChannel` so locking one tab locks all (item 17.8).
- Re-authentication (master password, and MFA where enabled) is required for: reveal, export, share, revoke, disable MFA, rotate master password, change account password.

### 6.8 Clipboard auto-clear

**R-31:** Preserve P-06 exactly, and extend it:
- Copy only via `navigator.clipboard.writeText` inside a real user gesture.
- Auto-clear after ≤ 45 s, with the **generation-counter guard** so a stale timer never wipes a newer unrelated clipboard value (this is the legacy implementation's good idea — keep it).
- Also clear on lock, logout and `pagehide`.
- Never request `clipboard-read`; deny it via `Permissions-Policy` (R-06a).
- Prefer flows that avoid the clipboard entirely where possible (direct fill, reveal-and-hide) and show a visible countdown so the user knows the clipboard will be cleared.
- Document the platform limitation honestly: clipboard history managers and other applications may retain the value beyond the app's control — this is a manual/pentest note, not something a test can assert.

### 6.9 Secrets handling

**R-13 / ZK-14:**
- Boot-time config validation with a schema; **every secret required, no default, minimum entropy enforced**; the process exits non-zero on a missing or placeholder value. (Directly fixes the V-F6/V-F7 class.)
- Distinct secrets per token class and per environment (R-14); boot fails if the access and refresh secrets are equal.
- Secrets come from a secret manager or injected environment, never from a committed file. `.env*` is gitignored; `.env.example` contains names only.
- Secret scanning (gitleaks/trufflehog) in CI **and** as a pre-commit hook; a hit fails the build.
- No secret in a `NEXT_PUBLIC_*` variable — a CI grep gate asserts no `NEXT_PUBLIC_` name matches `SECRET|KEY|TOKEN|PASSWORD`. This is a Next.js-specific footgun worth its own gate, because the prefix silently inlines the value into the client bundle.
- Documented rotation procedure and cadence for every secret, plus key-version support so rotation is not a migration (R-23).

### 6.10 Dependency policy

**R-50:**
- Lockfile committed; installs use `npm ci` (or the frozen-lockfile equivalent). Exact pins for anything in the crypto or auth path.
- `npm audit --audit-level=high` (or Snyk/Dependabot) gates CI; a high/critical advisory blocks merge.
- **Vault crypto uses Web Crypto only** — no third-party crypto package for vault primitives (P-02). Every dependency added to the vault bundle is one more place that R-04's key handles could leak from, so a new dependency on a vault route requires explicit review.
- Provenance/attestation checks and a lockfile-diff review on every dependency bump; no automatic merge of a bump touching the auth, crypto or serialisation path.
- Prohibited on vault routes: session-replay, analytics, AI SDKs, DOM-capturing error reporters, any tag manager (R-41, R-42).
- A generated SBOM per release, plus a scheduled re-scan so a newly disclosed advisory in an unchanged dependency is still caught.

### 6.11 Validation, serialisation, and other API hardening

- **R-47** — `ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })` applied globally in NestJS; every DTO fully typed and constrained. Every Next.js server action validates its input with a schema and re-checks auth/authz itself.
- **R-35** — Allow-list serialisation (`ClassSerializerInterceptor` with `@Expose` opt-in, or explicit DTO mapping). Never return an ORM entity. Preserves P-11 without depending on remembering to annotate each new sensitive field — a new field is hidden by default rather than exposed by default, which is the inverse of the `@JsonIgnore` model and strictly safer.
- **R-36** — Parameterised ORM queries only; raw SQL requires a reviewed exception with bound parameters (preserves P-12).
- **R-49** — No open redirect (allow-list every redirect target); no path traversal (no route accepts a client-supplied filesystem path); `rel="noopener noreferrer"` on external links; request body size limits; no user-controlled `href`/`src` scheme (`javascript:`/`data:` rejected).
- **R-34** — Audit logging (actor, IP, user-agent, action, resource) on every reveal/share/create/delete/purge/export, written in the same transaction as the action (preserves P-10).
- **R-33** — Identical status code, body shape **and response timing** for "not found" vs "not authorised" on every vault resource (preserves P-09).

---

## 7. Test plan hooks

### 7.1 Automatable (Playwright / Vitest / CI gates)

**Playwright (browser-level, end-to-end)**

1. **XSS inertness** — a fixture user whose display name contains angle-bracketed markup is rendered in every list, modal, picker and detail view; assert the markup appears as literal visible text, zero console entries, zero unexpected navigation, zero request to an unexpected host. *(V-XSS-01, R-01; script items 2.8, 5.11)*
2. **Key unreachability** — after unlock, a page-context probe asserts no enumerable global holds a `CryptoKey` or key-like bytes, no exported function returns key material, and `exportKey` on any reachable handle rejects. *(R-04; item 13.11)*
3. **No token or secret in the document** — assert the raw session token and the test secret appear nowhere in the HTML, `__NEXT_DATA__`, or RSC flight payload of any authenticated page. *(R-20, ZK-12; item 13.11)*
4. **Browser storage clean** — enumerate `localStorage`, `sessionStorage`, IndexedDB, cookies and the Cache API after unlock, after reveal, after lock and after logout; assert no plaintext and no key bytes. *(ZK-10; items 4.11, 13.1)*
5. **Auto-lock triggers** — idle timer, tab-blur past the grace period, `pagehide`, cross-tab lock propagation; assert reveal requires unlock again after each. *(V-F12, R-19; items 7.5, 7.6, 7.11, 17.8)*
6. **Clipboard auto-clear** — assert the clipboard is empty after the timeout, after lock, and after logout; assert a newer unrelated value is not wiped by a stale timer. *(R-31; items 14.2–14.7)*
7. **Console silence** — full vault workflow against a production build; assert zero `console.*` output. *(V-F14, R-21; item 13.12)*
8. **No outbound third-party / AI request** — network interception across the whole vault workflow; assert every request is same-origin or to the allow-listed API. *(R-40, R-41; items 15.1–15.7)*
9. **CSP and header snapshot** — assert the exact header set on every route, with a dedicated assertion that `script-src-attr` equals `'none'` and that `script-src` contains no `'unsafe-inline'`/`'unsafe-eval'` in a production build. *(R-02, R-46)*
10. **Cookie flags** — assert `HttpOnly`, `Secure`, `SameSite`, `__Host-` prefix and absence of `Domain` on every auth cookie. *(R-45)*
11. **No secret in title/URL/history/bfcache; `Referrer-Policy: no-referrer`.** *(ZK-11; item 13.10)*
12. **Accessibility** — `axe-core` scan on every vault screen; keyboard-only traversal of add/reveal/copy/lock. *(items 16.9, 16.11)*
13. **Edge/fault injection** — offline, API 500, slow network, forced tab close; assert the vault ends locked, the clipboard is cleared, and no plaintext persists. *(ZK-17; items 17.1–17.12)*

**Vitest / integration (API-level)**

14. **Authorization matrix** — table-driven over every (route × role × ownership tier); explicitly includes a `Guest` JWT, an unknown-role JWT, an empty/null role, and a non-string role, asserting rejection rather than coercion. *(V-F1, V-F4, R-07, R-10; items 6.7, 6.11, 6.12)*
15. **IDOR sweep** — for every vault route, substitute another tenant's id and assert an identical not-found response shape and comparable timing. *(ZK-16, R-33; items 6.1, 6.8)*
16. **Rate limits and lockout** — per surface in the §6.6 table; assert the counter is not resettable by rotating IP alone or account alone. *(V-F2, V-F3, R-08, R-09; items 2.16–2.19, 7.12)*
17. **Server-side password policy** — a direct API call with a 1-character password returns 400, on every password-accepting endpoint. *(V-F5, R-12; item 2.3)*
18. **KDF floor** — POST downgraded `kdfParams` on every write path; assert 400 and no mutation. *(V-F15, R-22; item 3.5)*
19. **Logout revocation** — replay a captured access token and refresh token after logout; both 401. *(V-F11, R-18; items 2.22, 7.3)*
20. **Token-class separation** — refresh token rejected as bearer, access token rejected at `/auth/refresh`; boot fails if the two secrets are equal. *(V-F7, R-14)*
21. **Error opacity** — force a unique-constraint violation; assert no table/column/constraint name and no SQL fragment in the response. *(V-F9, R-16; items 2.12, 11.5, 12.5)*
22. **Serialisation allow-list** — assert no response body contains a hash, ciphertext, IV, wrapped key, TOTP secret, or any unexposed field, across every endpoint. *(R-35, P-11; items 11.6, 11.10)*
23. **Zero-knowledge request capture** — record every request on the full workflow; assert the master password and plaintext appear in none. *(ZK-01; item 3.13)*
24. **Post-workflow store scan** — grep the DB, Redis, audit table and log output for the test secrets; assert zero hits. *(ZK-02, ZK-08, ZK-09; items 4.10, 4.12, 4.14, 12.7)*
25. **Crypto unit tests** — IV uniqueness across repeated encryptions; tampered ciphertext/tag fails authentication; salt uniqueness and length; a v1 record still decrypts after a v2 key exists. *(ZK-15, R-23; items 4.5, 4.17, 4.18)*
26. **Generator uniformity** — statistical check over a large sample; no modulo bias. *(V-F18, R-25; item 1.11)*
27. **Share revocation rotates the secret** — a previously issued wrapped key no longer decrypts the current ciphertext after revoke. *(V-F21, R-28; item 5.18)*
28. **AI-role DB grants** — `SELECT` against every vault table as the AI/DB-Bot role returns a permission error. *(R-39; items 12.9, 15.10)*
29. **Fail-fast config** — boot with each secret unset or set to a placeholder; assert non-zero exit. *(V-F6, R-13; item 12.3)*
30. **Swagger gated** — unauthenticated GET of `/docs`, `/docs-json`, `/swagger`, `/api-json` in production mode returns 404/401. *(V-F10, R-17; item 11.15)*
31. **CORS** — a foreign `Origin` receives no `Access-Control-Allow-Origin`. *(R-48)*
32. **CSRF** — every mutating route (including server actions) rejects a missing/invalid token and a foreign `Origin`. *(R-37; item 9.10)*
33. **Mass assignment** — unexpected body fields are stripped and never persisted. *(R-47; item 11.16)*
34. **Audit completeness** — every reveal/share/create/delete/purge/export writes an audit row; an action that cannot be audited fails. *(R-34; items 5.16, 12.x)*

**CI static gates (cheap, fast, catch the legacy failure mode)**

35. ESLint `react/no-danger: error`; grep gate banning `innerHTML`/`outerHTML`/`insertAdjacentHTML`/`document.write`/`eval`/`new Function` and `setAttribute` with an `on*` name. *(R-01)*
36. Grep gate: no assignment to `window.*`/`globalThis.*` in the vault module; no exported function returning key material. *(R-04)*
37. Grep gate: `user.name`/`displayName` interpolated only inside the single `<UserName>` component. *(R-03 — the structural fix for the "one inconsistent instance" failure mode)*
38. Grep gate: no admin-level role assigned in an `else`/negated-comparison branch. *(R-07)*
39. Grep gate: no `NEXT_PUBLIC_*` name matching `SECRET|KEY|TOKEN|PASSWORD`; no `Math.random` in the repo. *(R-13, R-25)*
40. Architecture-fitness test (`dependency-cruiser` / `eslint-plugin-boundaries`): **no import edge between the vault module and the AI module in either direction.** *(R-38; item 15.9)*
41. Bundle-analysis gate: the vault route's client bundle contains no AI, analytics, session-replay, or DOM-capturing error-reporter package. *(R-41)*
42. Secret scanning (gitleaks/trufflehog) in CI and pre-commit. *(ZK-14)*
43. `npm audit --audit-level=high` gate; SBOM generation; scheduled re-scan. *(R-50)*
44. Field-classification test: a new vault column fails the build until it is classified opaque/metadata in the checked-in table. *(ZK-06, ZK-07)*
45. Route-coverage test: every registered route is covered by an explicit auth policy; an unpoliced route fails the build (default-deny). *(R-07, R-10; item 11.9)*
46. Every fixed finding has a named regression test; the map from finding id → test is checked in and completeness-asserted. *(item 18.6)*

### 7.2 Requires manual / pentest verification

1. **Live execution of the [POC] chain after the fix** — [POC] §6.5 explicitly asks for it: "After the fix, repeat the PoC above and confirm the payload renders as inert text, not executable markup." A synthetic Playwright fixture proves the sink is safe; only a real attempt against a real instance proves the *chain* is broken. **This must be executed — it is still listed as "Not yet performed" in [POC] §7.**
2. **Free-form XSS hunt** across every user-controlled field and every render path, including SSO-provisioned display names, imported vault data, folder/group names, and share-link messages. An automated fixture only tests the payload classes someone thought of.
3. **CSP bypass attempt** — script gadgets in the framework and dependencies, `strict-dynamic` propagation, Trusted Types policy escape, and confirmation that navigation-based exfiltration is contained by R-04 rather than by CSP.
4. **Memory-dump inspection** ([SCRIPT] §13.7) — heap snapshot and process core inspection for residual key/plaintext after lock. Not automatable in any reliable way.
5. **Clipboard behaviour against real OS clipboard managers and clipboard history** — outside the browser's control and outside a test harness.
6. **Cryptographic design review by a reviewer who did not write it** — envelope format, key hierarchy, sharing/wrapping scheme, recovery-key design, rotation design. [AUDIT] scored Encryption 9/10 on a static read; the rewrite's crypto is new code and deserves a fresh, adversarial review.
7. **Live authorization pentest** — creative role/token manipulation, JWT algorithm confusion (`alg: none`, HS/RS confusion), claim injection, tenant confusion in share flows. The matrix test covers the cases enumerated; a pentester finds the ones that were not.
8. **Business-logic abuse of the sharing model** — share-then-revoke races, group membership changes mid-operation, share-link forwarding, recipient substitution, and the V-F21 "revocation does not un-know" class in its full generality.
9. **Live brute-force and lockout behaviour under distributed load** — verifying the limit holds across instances, that lockout cannot be used to DoS a legitimate account, and that anomaly alerting actually fires.
10. **Infrastructure and deployment review** — TLS configuration and cipher suites, HSTS preload state, DB network isolation, backup encryption and restore-path access control, log retention and access controls (V-F20's PII requirement), secret-manager IAM.
11. **AI boundary review** ([SCRIPT] §15 / R-43) — the architecture-fitness test proves no import edge and the DB grants prove no read path, but a human must confirm no *operational* path exists: no log shipped to an AI pipeline, no DB replica the bot can reach, no support tooling that pastes vault context into a prompt, no future feature quietly widening the bot's grants.
12. **Live UX pass** — [AUDIT] recorded UX as **"Not assessed ... recommend a separate live UX pass."** That pass is owed. `axe-core` covers mechanical accessibility; the confusing-workflow judgement of [SCRIPT] §16.13 is human work.
13. **Recovery and disaster scenarios** — master-password loss, recovery-key use, account deactivation with owned shares outstanding, DB restore from backup, and confirming the zero-knowledge property survives each.
14. **Threat-model review of the crypto-worker boundary (R-04)** — the worker is the new defence and therefore the new attack surface. Confirm the operation set is minimal, that the rate limit and gesture requirement are not trivially forgeable by injected script, and that terminating the worker really does drop the key material.

---

## Appendix — traceability

| Legacy finding | Severity | Doc status | New-stack requirement(s) | Acceptance items |
|---|---|---|---|---|
| V-XSS-01 (stored XSS → key theft) | 🔴 | **Open** (fix not applied, retest pending) | R-01, R-02, R-03, R-04, R-05, R-06, R-06a | 2.8, 5.11, 13.11, 9.11 |
| V-F1 (role escalation to Admin) | 🔴 | **Open** (release blocker) | R-07 | 6.7, 6.11, 6.12, 2.25 |
| V-F2 (no login brute-force protection) | 🟠 | **Open** | R-08 | 2.16–2.19 |
| V-F3 (no MFA brute-force protection) | 🟠 | **Open** | R-09 | 7.12 |
| V-F4 (blanket Admin gate on vault) | 🟡 | **Open** | R-10, R-11 | 6.7, 6.3 |
| V-F5 (no server-side password policy) | 🟡 | **Open** | R-12 | 2.3 |
| V-F6 (placeholder secret fallbacks) | 🟢 | Open | R-13 | 12.3 |
| V-F7 (shared refresh/access secret) | 🟢 | Open | R-14 | — (test 20) |
| V-F8 (non-constant-time TOTP compare) | 🟢 | Open | R-15 | 7.12 |
| V-F9 (raw DB message in 400) | 🟢 | Open | R-16 | 2.12, 11.5, 12.5 |
| V-F10 (public Swagger) | 🟢 | Open | R-17 | 11.15 |
| V-F11 (no logout revocation) | 🟢 | Open | R-18 | 2.22, 7.3 |
| V-F12 (no lock on tab-blur) | 🟢 | Open | R-19 | 7.5, 7.6, 7.11 |
| V-F13 (JWT in view scope) | 🟢 | Open (latent) | R-20 | 13.11 |
| V-F14 (console logging of grants) | 🟢 | Open | R-21 | 13.12 |
| V-F15 (no server-side KDF floor) | 🟢 | Open | R-22 | 3.5 |
| V-F16 (no key rotation) | 🔵 | Open | R-23 | 4.18 |
| V-F17 (no app-level HSTS) | 🔵 | Open | R-24 | §6.2 |
| V-F18 (modulo bias in generator) | 🔵 | Open | R-25 | 1.11 |
| V-F19 (GET reveal) | 🔵 | Open | R-26 | 5.2 |
| V-F20 (PII in logs) | 🔵 | Open | R-27 | 12.7 |
| V-F21 (no rotation on share revoke) | 🔵 | Open | R-28 | 5.18 |
| P-01…P-17 (preserved strengths) | — | Working today | R-29…R-42, R-45…R-50 | throughout |

**Baseline verdict to beat:** [AUDIT] scored the legacy module **6.5/10 overall — "⚠️ Ready with required fixes — not ready for production as-is."** The rewrite's target is every 🔴/🟠 item closed by construction (not by patch), every P-item preserved, and a clean live retest of the [POC] chain.
