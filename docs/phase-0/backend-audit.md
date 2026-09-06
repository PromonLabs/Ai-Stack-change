# Backend Audit — OrgPortalBackend (Spring Boot 3.5.6 / Java 21)

**Audit target:** `C:\Users\Sandhosh\OneDrive - Promon Software Solution\Desktop\Apps\OrgPortalBackend`
**Purpose:** source of truth for the NestJS rewrite — the mirror-image of `docs/phase-0/frontend-audit.md` (Laravel side). Together the two documents give a 1:1 route/module inventory to check the rewrite against, and this document supplies the structural detail that `docs/phase-0/security-baseline.md` assumes but doesn't itself provide.
**Method:** every controller, and every backing service/entity/repository needed to document behavior, was read directly by three parallel audit passes (auth/security/integrations; core ticketing/ops/admin modules; vault + Flyway migrations). All facts are cited to file:line in the audited repo. No secret values are reproduced — only config key names. Package root is `com.ticketraise`.

**Status:** this fills the "backend audit" gap in Phase 0 (`frontend-audit.md` existed; this did not). It does not by itself close the other open Phase 0 checklist items in the top-level `README.md` (Entra ID app registration details, a staging DB snapshot for Prisma introspection, sign-off that `UI_MODERNIZATION_PLAN.md` is superseded) — those still need input from whoever owns those systems/decisions.

---

## How to read this document

- **Part 1 — Auth, Security Config, Identity & External Integrations.**
- **Part 2 — Core modules** (Dashboard, Tickets, Approvals, Analytics/Reports, Hour Tracking, Seat Booking, Admin: Groups/Documents/Roles/Domains/Categories/Projects/Resolution Notes/SLA Config, Interview & Assessment, Notifications).
- **Part 3 — Password Manager & Policy Management (the flagship module) + the full Flyway migration inventory.**
- **Cross-cutting findings** — a consolidated, severity-ranked list at the end, pulled from all three parts, for whoever scopes the rewrite's security-hardening work.

---

# Part 1 — Auth, Security Config, Identity Controllers & External Integrations

Scope: `config/**`, `security/**`, `AuthController`, `UserController`, `InternalUserController`, `ChatController`, `AiChatAdminController`, `Service2ProxyController`, `PhotoSyncAdminController`, `HealthController`, `application.properties`, `GlobalExceptionHandler`, and the Entra ID / Graph / Service-2 / LiteLLM integration wiring.

## 1.1 Stack facts

| Fact | Evidence |
|---|---|
| Framework | Spring Boot 3.x, layered packages (`controller/service/repository/model`) | `src/main/java/com/ticketraise/**` |
| Security | Spring Security, stateless JWT (HS256), custom `OncePerRequestFilter` | `security/JwtAuthFilter.java:1-106`, `config/SecurityConfig.java:1-119` |
| Method security | `@EnableMethodSecurity` enabled; only `ChatController` (in this scope) uses `@PreAuthorize` — every other admin check in scope is manual in the controller/service body | `config/SecurityConfig.java:27`; `controller/ChatController.java:29`; `controller/AiChatAdminController.java:215-218`; `controller/PhotoSyncAdminController.java:73-76` |
| Password hashing | BCrypt, configurable rounds | `config/SecurityConfig.java:36-42` (`app.security.bcrypt-rounds`, default 10) |
| DB | PostgreSQL via `spring.datasource.*`, Flyway migrations | `application.properties:20-24,36-39` |
| API docs | springdoc-openapi (Swagger UI), publicly reachable (see §1.3) | `config/SwaggerConfig.java:1-54`, `config/SecurityConfig.java:73-87` |
| OAuth2 client support | `spring-security-oauth2-client` used ONLY for the outbound Service-2 client-credentials call — no Spring Security OAuth2 *login* client is registered for Microsoft | `config/WebClientConfig.java:13-18,41-55`; `application.properties:86-90` |
| Microsoft login flow | Hand-rolled authorization-code exchange (not Spring's OAuth2 login, not MSAL) | `service/MicrosoftOAuthService.java:51-192` |
| AI chat backend | LiteLLM gateway proxy (`LiteLlmService`) — **not** a direct Claude/OpenRouter SDK call, see §1.7 | `service/LiteLlmService.java:1-332` |

## 1.2 Route inventory (in-scope controllers)

| Method | Path | Controller@method | Security | Auth requirement |
|---|---|---|---|---|
| POST | `/api/auth/login` | `AuthController@login` | permitAll | None (public) |
| POST | `/api/auth/signup` | `AuthController@signup` | permitAll | None (public) |
| POST | `/api/auth/register` | `AuthController@register` | authenticated | Valid JWT; admin-only enforced in `AuthService.register` (`:75-77`), not at controller/annotation level |
| POST | `/api/auth/refresh` | `AuthController@refresh` | permitAll | None (takes refresh token in body) |
| POST | `/api/auth/logout` | `AuthController@logout` | authenticated | Valid JWT (stateless no-op handler, see §1.6) |
| GET | `/api/auth/microsoft` | `AuthController@microsoftRedirect` | permitAll | None (public) |
| GET | `/api/auth/microsoft/callback` | `AuthController@microsoftCallback` | permitAll | None (public) |
| GET | `/api/auth/microsoft/exchange` | `AuthController@exchangeMicrosoftCode` | permitAll | None (one-time code, server-to-server) |
| GET | `/api/users` | `UserController@list` | authenticated | Valid JWT; role filtering delegated to `UserService.list` (not verified) |
| GET | `/api/users/assignable` | `UserController@assignable` | authenticated | Valid JWT; documented as available to any authenticated role |
| GET | `/api/users/{id}/profile` | `UserController@getProfile` | authenticated | Valid JWT |
| GET | `/api/users/{id}` | `UserController@getById` | authenticated | Valid JWT; admin-only per Swagger doc text, enforced in `UserService.getByIdForAdmin` |
| PATCH | `/api/users/{id}/profile` | `UserController@updateProfile` | authenticated | Valid JWT |
| POST | `/api/users/{id}/change-password` | `UserController@changePassword` | authenticated | Valid JWT |
| GET | `/api/users/{id}/activity` | `UserController@activity` | authenticated | Valid JWT + explicit self-or-admin check (`UserController.java:153`) |
| PATCH | `/api/users/{id}/role` | `UserController@updateRole` | authenticated | Valid JWT; admin check delegated to service |
| PATCH | `/api/users/{id}/deactivate` | `UserController@deactivate` | authenticated | Valid JWT; admin check delegated to service |
| PATCH | `/api/users/{id}/manager` | `UserController@updateManager` | authenticated | Valid JWT; admin check delegated to service |
| POST | `/api/users/{id}/reset-password` | `UserController@adminResetPassword` | authenticated | Valid JWT; admin check delegated to service |
| PATCH | `/api/users/{id}/admin-update` | `UserController@adminUpdateUser` | authenticated | Valid JWT; admin check delegated to service |
| POST | `/api/users/{id}/daily-report` | `UserController@saveDailyReport` | authenticated | Valid JWT |
| PATCH | `/api/users/{id}/daily-report` | `UserController@adminUpdateDailyReport` | authenticated | Valid JWT; admin check delegated to service |
| GET | `/api/users/{id}/daily-reports` | `UserController@getDailyReports` | authenticated | Valid JWT |
| GET | `/api/users/team-hours` | `UserController@teamHours` | authenticated | Valid JWT; Domain Lead auto-scope delegated to service |
| DELETE | `/api/users/{id}` | `UserController@deleteUser` | authenticated | Valid JWT; admin check delegated to service |
| GET | `/api/internal/users` | `InternalUserController@listAllUsers` | authenticated | Valid JWT **and** `app.debug.allow-public-user-list=true` (default `false`) |
| GET | `/api/chat/models` | `ChatController@models` | `@PreAuthorize("hasRole('Admin')")` | Valid JWT, `ROLE_Admin` |
| GET | `/api/chat/gateway-status` | `ChatController@gatewayStatus` | `@PreAuthorize("hasRole('Admin')")` | Valid JWT, `ROLE_Admin` |
| POST | `/api/chat/completions` | `ChatController@completions` | `@PreAuthorize("hasRole('Admin')")` | Valid JWT, `ROLE_Admin` |
| GET/POST/PATCH/DELETE | `/api/ai-chat/admin/group-mappings*`, `/api/ai-chat/admin/overrides*` (9 endpoints) | `AiChatAdminController` | manual `requireAdmin()` | Valid JWT + `RoleNormalizer.isAdmin` |
| GET | `/api/proxy/service2/data` | `Service2ProxyController@proxy` | **authenticated only — no admin/role check at all** | Valid JWT only |
| GET | `/api/admin/sync-photos` | `PhotoSyncAdminController@syncPhotos` | manual `requireAdmin()` | Valid JWT + `RoleNormalizer.isAdmin` |
| GET | `/api/health` | `HealthController@health` | permitAll | None (public) |

## 1.3 SecurityConfig — filter chain & public surface

`config/SecurityConfig.java`:
- Stateless session policy, CSRF disabled (`:48-49`).
- `permitAll` (`:51-88`): auth endpoints + health check + full Swagger/OpenAPI surface + two calendar read endpoints (`/api/tickets/calendar/events`, `/calendar/statistics` — Part 2 covers these controllers) with an inline comment that they're "protected at the Laravel layer" instead.
- `jwtAuthFilter` inserted before `UsernamePasswordAuthenticationFilter` (`:91`).
- Response headers (`:92-99`): `X-Frame-Options: DENY`, `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`, `Referrer-Policy: same-origin`, `X-Permitted-Cross-Domain-Policies: none`. **No HSTS** (already V-F17 in `security-baseline.md`).
- CORS (`:103-118`): origins from `app.cors.origin`, methods `GET,POST,PUT,PATCH,DELETE,OPTIONS` (no `HEAD`), all headers, credentials allowed, applied to `/**`.

## 1.4 JwtAuthFilter — claims, validation, role handling

`security/JwtAuthFilter.java`:
- Reads `Authorization: Bearer <token>` (`:36-38`). On valid token, extracts `role, id, email, name, domain_ids` (`:41-48`).
- **Token-version revocation** (`:50-65`): reads `tv` claim (default `0`), re-queries `UserRepository`, requires `tokenVersion` match + `isActive()` + `!isDeleted()`. On mismatch, request proceeds unauthenticated (no exception) — `anyRequest().authenticated()` downstream produces the 401/403.
- **Role normalization** (`:67-73`, confirmed unchanged from `security-baseline.md`'s citation): known aliases map to `"Admin"`; then **any value that isn't exactly `"Admin"` or `"User"` is forced to `Role.ADMIN`** — including `"Guest"` (a canonical role, `model/Role.java:47`), which therefore gets `ROLE_Admin`, not `ROLE_Guest`. Confirming the existing V-F1 citation, not a new finding.
- Only two effective authorities ever reach `SecurityContextHolder`: `ROLE_Admin`, `ROLE_User` (`:` — single `SimpleGrantedAuthority`).
- Logs `userId, email, raw/normalized role, path` at INFO (`:77-84`) — no token value logged.

## 1.5 JwtUtil — token issuance

`security/JwtUtil.java`:
- Access token: `id, email, name, role, domain_ids, tv`; `sub`=user id; HS256 with `app.jwt.secret`; expiry `app.jwt.expiry` (`:37-56`).
- Refresh token: `sub, iat, exp` only; HS256 with `app.jwt.refresh-secret` (`:58-65`) — **falls back to the same value as `app.jwt.secret`** when `JWT_REFRESH_SECRET` is unset (`application.properties:61`).
- `parseMicrosoftIdTokenClaims` (`:92-111`) decodes a Microsoft `id_token` **without signature verification** (intentional per class comment) — appears to be dead/duplicate code; no callers found repo-wide.

## 1.6 AuthController & AuthService — login/register/refresh/Microsoft

- `POST /api/auth/login` (`AuthController.java:42-51` → `AuthService.java:45-71`): email/password via `passwordEncoder.matches`, requires `isActive()` and a non-null password hash (Microsoft-SSO-only accounts have none). Confirmed as cited.
- `POST /api/auth/logout` (`:90-96`) — stateless no-op, `{"message":"Logged out"}`, no revocation, no blacklist. Confirmed as cited.
- Microsoft OAuth flow (custom, not Spring OAuth2 login, not MSAL):
  1. `GET /api/auth/microsoft` → `MicrosoftOAuthService.buildAuthorizationUrl()` redirects to `https://login.microsoftonline.com/{tenant}/oauth2/v2.0/authorize`, scope `openid profile email offline_access User.Read GroupMember.Read.All Team.ReadBasic.All` (`:41-63`).
  2. `GET /api/auth/microsoft/callback?code=...` → server-side POST to `.../oauth2/v2.0/token` (`:79-98`), decodes `id_token` (no signature check) for profile claims, extracts an Azure AD App Roles claim from `id_token` first, falling back to `access_token` (`:122-136`).
  3. The auth payload (JWT + refresh + user) is stored server-side in `OAuthCallbackStore` (in-memory `ConcurrentHashMap`, 120s TTL, single-use); only a random UUID code goes in the redirect URL (`AuthController.java:121-125`; `OAuthCallbackStore.java:23-55`) — replaces an earlier design that put the JWT itself in the redirect.
  4. `GET /api/auth/microsoft/exchange?code=...` (server-to-server, called by the Laravel frontend) exchanges the one-time code for the real JWT payload (`AuthController.java:132-145`).
- `AuthService.microsoftLoginOrRegister` (`:122-185`): find-or-create by email; new users get the AD-App-Role-mapped role or default `User`; existing users' role only changes when the AD claim is present (never silently downgraded on absence); a role change bumps `tokenVersion` (`:156-163`, ties into the `tv` check above). Graph profile sync runs every login, never blocks on failure (`:178`).
- Entra ID app-registration config keys: `app.microsoft.client-id`, `app.microsoft.client-secret`, `app.microsoft.redirect-uri`, `app.microsoft.tenant` (`application.properties:44-47`); `app.microsoft.mail.sender` for Graph-sendMail (`:55`).

## 1.7 External integrations

| Integration | Client class | Base URL config key | Auth mechanism | Timeout/retry |
|---|---|---|---|---|
| Microsoft Entra ID (login) | `MicrosoftOAuthService` | Hardcoded `login.microsoftonline.com/{tenant}/...` | Authorization-code exchange, `app.microsoft.client-id/secret` | 10s, no retry |
| Microsoft Graph (delegated) | `GraphApiService` | Hardcoded `graph.microsoft.com/v1.0` | `Bearer <delegated access_token>` (never persisted) | 8s/call, 10-page cap, no retry |
| Microsoft Graph (app-only) | `GraphAppService` | Hardcoded, `client_credentials` grant, scope `.default` | same client id/secret/tenant | 10s token, 8s photo fetch, no retry |
| Microsoft Graph sendMail | `GraphMailService` | Hardcoded; sender from `app.microsoft.mail.sender` | reuses `GraphAppService`'s app-only token | 10s, retries on HTTP 429 |
| Service 2 (outbound proxy) | `Service2Client` / `service2WebClient` | `service2.api.base-url` (**never set** in `application.properties` — only its OAuth2 registration is; runs on hardcoded default `localhost:8082`) + `service2.api.data-path` | OAuth2 `client_credentials` (`spring.security.oauth2.client.registration.service2.*`) | default Reactor Netty timeouts, no explicit config |
| Seat-Booking Service | `seatBookingWebClient` bean, base URL `seat-booking.api.base-url` (default `http://192.168.170.47:8080`) — consuming `SeatBookingService` out of this part's scope | — | — | — |
| AI Chat — LiteLLM Gateway | `LiteLlmService` | `app.litellm.base-url` (default `https://ai-gateway.promon.co.in`) | per-user personal key (AES-256-encrypted via `CredentialCipherService`); `app.litellm.shared-key` is a documented **temporary bypass** collapsing all users onto one shared key | 10s provisioning, 4s liveliness, 60s completions; no retry; self-signed cert trusted via a dedicated WebClient bean |
| Claude API / OpenRouter | **No consuming code found anywhere in the repo.** | — | — | `app.claude.api-key`, `app.claude.model`, `openrouter.api.key` (`application.properties:96-100`) are **dead configuration** — no `BotController`, no reference anywhere in `src/main/java`. The live AI integration is the LiteLLM gateway above. |

Other `application.properties` notes: the LiteLLM config block (`:73-83`) is duplicated verbatim at `:102-112`; the file ends with a stray invalid line `Microsoft Azure` at `:148` (no `=`, harmless but dead); `app.debug.allow-public-user-list` (default `false`) carries an explicit "Do NOT enable in production" warning (`:132-134`).

## 1.8 GlobalExceptionHandler

`exception/GlobalExceptionHandler.java` (`@RestControllerAdvice`): `ApiException` → its status + `{"error"}`; validation errors → 400 + field map; `AuthenticationException` → 401 generic; `AccessDeniedException` → 403 generic; `HttpMessageNotReadableException`/`MethodArgumentTypeMismatchException` → 400 with the underlying exception message included; **`DataIntegrityViolationException` → 400 echoing `ex.getMostSpecificCause().getMessage()`** (confirmed cited finding, DB-internals leak); catch-all → 500 generic, full trace logged server-side only.

## 1.9 Citation check against `security-baseline.md` §1

All 6 file:line citations in scope (`JwtAuthFilter.java:70-73`; `AuthController.java:42-51,90-96`; `SecurityConfig.java:52-54,73-87`; `application.properties:22,59,61`; `GlobalExceptionHandler.java:68-75`; `TotpService.java:43-51,48`) were **confirmed accurate — no line-number drift**.

## 1.10 Gaps for the NestJS port

- `MicrosoftOAuthService`/`GraphApiService`/`GraphAppService` are hand-written `WebClient` calls, not MSAL4J or Spring's OAuth2 login client — don't assume a drop-in `passport-azure-ad`/MSAL "login" strategy maps 1:1. The one-time-code indirection via `OAuthCallbackStore` (in-memory, single-instance) must be reproduced with a shared store if the NestJS API is horizontally scaled.
- `Service2Client`'s real base URL is unset in this repo's properties file — confirm the actual deployed value before porting.
- `app.claude.api-key`/`app.claude.model`/`openrouter.api.key` are dead; do not carry them into NestJS config as if they gate a live feature.

---

# Part 2 — Core Modules (Dashboard, Tickets, Ops, Admin, Interview, Notifications)

Scope: `DashboardController`, `BoardConfigController`, `TicketController`, `TicketRelationshipController`, `TicketWatcherController`, `AssignmentController`, `ReminderController`, `AnalyticsController`, `ReportController`, `HourTrackingLogController`, `HourTrackingProjectController`, `HourTrackingTeamController`, `HourTrackingTicketController`, `SeatBookingController`, `SeatAdminController`, `RoomAdminController`, `GroupController`, `DocumentController`, `RoleController`, `DomainController`, `CategoryController`, `ProjectController`, `ResolutionNoteController`, `SlaConfigController`, `InterviewRecruiterController`, `InterviewTestController`, `NotificationController`.

## 2.1 Stack facts

| Fact | Evidence |
|---|---|
| Base path convention | Every controller is `@RestController` under `/api/...` — no server-rendered views |
| Auth mechanism | `@AuthenticationPrincipal AppUserDetails actor` on nearly every endpoint; role checks are almost always a **manual `RoleNormalizer.isAdmin(actor.getRole())`** call in the method body, not `@PreAuthorize` — see the inconsistency flag below |
| Raw SQL usage | `DashboardController`, `AnalyticsController`, `RoleController` (delete path) hand-write SQL via `JdbcTemplate`, breaking from the rest of the codebase's Controller→Service→Repository pattern |

## 2.2 Dashboard

| Method | Path | Handler | Authorization | Notes |
|---|---|---|---|---|
| GET | `/api/dashboard` | `DashboardController.summary` (`:29`) | none declared; branches internally via `RoleNormalizer.isAdmin` (`:33`) | Raw SQL: `userSummary` scopes `reporter_id=?` (`:41-52`); `adminSummary` is global, unfiltered by domain (`:68-76`) — **no per-domain admin scoping exists here**, unlike `AnalyticsController` |

Laravel exposes `/api/dashboard/board-tickets` + `/api/dashboard/board-config`; Spring has no `board-tickets` equivalent (ticket-board data comes from `TicketController`) and `board-config` is a separate sibling controller, not nested under Dashboard — **naming/location mismatch to resolve in the NestJS port**.

## 2.3 Board Config (Kanban)

Single shared global row (`BoardConfigController.java:44`, `findTopByOrderByUpdatedAtDesc().orElseGet(BoardConfig::new)`) — column order/colors are **global, not per-user, not per-board**. GET is open to all (no `actor` param), never 404s. PUT requires manual admin check. The NestJS port must replicate "last write wins, single global row" exactly.

## 2.4 Tickets

Base `/api/tickets`, ~19 endpoints. Every endpoint relies on **service-layer** authorization (`TicketService.assertCanManage`, `assertNotTerminal`, `requireCanManageAssignment` — `TicketService.java:769-787`) rather than a controller-boundary guard — a NestJS port must re-derive and make this logic explicit (guards/interceptors) or the same footgun (a new endpoint forgetting the assert call) reproduces in the new stack.

**Approval chain** (`ApprovalService.java`): reporter role `User` → flow `T1` (two approval rows: `T1_Lead` then `Admin`); anything else → flow `T2` (one `Admin` row). T1_Lead approver is auto-assigned by a **configured email** (`app.approval.t1-lead-email`) — if no active user matches, the row has no approver and only an Admin can act on it. Rejection is terminal — no resubmission flow.
**Critical finding:** `validateApprover` (`:180-190`) never authorizes non-Admins — the `boolean valid` local is never set `true` for any branch but Admin — so **T1_Lead-level approval is unreachable by anyone but an Admin**, despite the flow explicitly modeling and auto-assigning a T1 lead. The NestJS port must decide deliberately whether to preserve this (broken?) lockdown or implement real T1_Lead authorization — copying the code as-is silently perpetuates it either way.

**Calendar** (`/api/tickets/calendar/events`, `/calendar/statistics`): reads directly from `tickets.sla_deadline`, not `calendar_events` (deliberate, so tickets predating the sync still show). `isRecurring` is hardcoded `false` everywhere — **no recurring-event model exists on the backend at all**; must be built net-new in NestJS if the product needs it. SLA urgency bucketing is computed ad hoc with hardcoded thresholds, **not** using `SlaConfigController`'s admin-configurable values. **Neither calendar endpoint has any auth check** — no `@AuthenticationPrincipal` param at all, unlike every other `TicketController` endpoint (also permitAll'd at `SecurityConfig` level, per §1.3).

**SLA calculation** (`TicketService.java:53-74`): defaults Critical=1d/High=3d/Medium=7d/Low=10d in minutes; looks up the latest `SlaConfig` row, falls back to defaults, falls back to 7d for an unrecognized priority. Applied at ticket creation only — **not recalculated if priority changes later** (not independently re-verified beyond `create`; flagged as a pre-port risk to confirm).

## 2.5 Ticket Relationships / Watchers / Reminders

- **Relationships:** `create`/`delete` gated by `assertCanManage` + `assertNotTerminal`; valid types `related, duplicate, blocks, is_blocked_by, parent, child, cloned_from`; duplicate-pair check is bidirectional. Notification/audit failures are best-effort, never roll back the save.
- **Watchers — asymmetric authorization:** `watch` lets any caller add *another* user as a watcher with **no permission check** (`TicketWatcherController.java:41-69`), while `unwatch` requires self-or-Admin (`:73-86`) — same resource, inconsistent gate.
- **Reminders:** `listForTicket` has **no check that the ticket exists** (unlike sibling controllers' `ticketMustExist` guard) — silently returns empty for a bogus id. `delete` is **self-only, no Admin override** — unusual, since almost every other delete endpoint in scope allows Admin.

## 2.6 Approvals / Analytics / Reports

- **Analytics** (`/api/analytics`, 5 endpoints) — all Admin-only, all hand-built parameterized raw SQL (`buildDomainFilter`); `hours-by-domain` reads `users.daily_reports` JSONB directly, a distinct legacy storage pattern from the newer relational `HourTrackingLogController`.
- **Reports** (`/api/reports`, class-level Admin) — **document/compliance reporting only**, unrelated to ticket analytics or Hour Tracking. **Flag:** the Laravel Hour Tracking PDF export routes (`hour-tracking.reports.pdf`, `hour-tracking.team.pdf`) have **no visible Spring equivalent** anywhere in the four Hour Tracking controllers audited — either the generation logic lives outside this scope or it must be built net-new in NestJS.

## 2.7 Hour Tracking

Four controllers: Logs (`/api/hour-tracking/logs`), Projects, Teams, Tickets (settings hierarchy). Logs: daily total capped at 24.00h (`HourTrackingLogService.MAX_DAILY_HOURS`), owner-or-Admin update/delete. Projects/Teams/Tickets form a strict **Team → Project → Ticket → Log** hierarchy where each level's admin CRUD blocks deletion if the level below still has live rows — this cascading-guard pattern is copy-pasted three times (each controller has its own private helpers) rather than shared, and should become one validator in NestJS.

## 2.8 Seat Booking

`SeatBookingController` (`/api/seats`) — **zero role checks anywhere in the file**, including `/api/seats/report`, which returns **org-wide booking data to any authenticated user, no admin gate** — inconsistent with `SeatAdminController`/`RoomAdminController` (`/api/admin/seats`, `/api/admin/rooms`), which gate all *management* behind Admin via `requireAdmin`. Reporting is more permissive than management here — a deliberate decision needed in the port, not a silent carry-over. `bookSeats` catches `RuntimeException` and returns 400 with the raw message, inconsistent with the rest of the codebase's typed `ApiException` convention.

## 2.9 Admin: Groups / Documents / Roles / Domains / Categories / Projects / Resolution Notes / SLA Config

- **Groups** (`/api/groups`) — `list`/`get` have **zero auth annotation and no `actor` param at all**: any caller who can reach the API (authenticated or not, depending only on the global filter chain) can see full group membership. Every sibling admin-resource controller at least declares `actor` even when GET is open to all.
- **Documents** (`/api/documents`) — **highest-severity finding in this part:** `GET /api/documents/{id}` (`:119-124`) has **no `@PreAuthorize` and no assignment check**, returning the full `Document` entity **including base64 `fileData`** to any authenticated caller who knows/guesses the id. Every write path (`create`, `batch`, `upload-with-assignments`) is properly Admin-gated and enforces team/person assignment — the read path serving the actual file bytes has no equivalent enforcement. This must be closed, not reproduced, in the NestJS rewrite.
- **Roles** (`/api/roles`) — delete is deliberately raw-JDBC (avoids a Hibernate stale-cache issue), reassigns affected users to `User` first, blocks deleting the canonical `Admin`/`User` roles.
- **Domains / Categories / Projects / Resolution Notes** — consistent shape: GET open to all, mutations `requireAdmin`, delete blocked if any ticket still references the row. `ProjectController`'s soft-delete reactivates a previously-deleted project on name reuse instead of violating a unique constraint — a subtle behavior a naive NestJS CRUD port could miss. **Naming note:** this `ProjectController` (ticket categorization) is entirely distinct from Hour Tracking's own "Projects" concept — two unrelated "Project" entities exist; keep them as two separate modules/tables in NestJS.
- **SLA Config** — same single-shared-global-row pattern as Board Config.

## 2.10 Interview & Assessment

`InterviewRecruiterController` — class-level Admin, all endpoints. `InterviewTestController` — **mixed authorization within one controller**: `run-code`, and all `/tests/public/*` endpoints (validate-token/start/submit/log-violation) require no role; most everything else is Admin.

**Critical finding — no real sandbox.** `InterviewTestService.executeCode` (`:23-119`), called from both the Admin-gated `/submit-technical` and the **completely unauthenticated** `/run-code` and `/tests/public/run-code`, is a raw `ProcessBuilder` running the **host's own `python`/`javac`/`java` binaries** with only a wall-clock timeout (2s run / 5s Java compile) — no container, chroot, seccomp, cgroup, memory cap, or network isolation. `/api/interview/tests/public/run-code` needs **no authentication and no valid test token at all** (unlike `/tests/public/submit`, which validates a token first) — any unauthenticated caller can submit arbitrary Python/Java source for execution on the API host. **This is the single highest-risk item in the entire audit.** The NestJS rewrite must treat this as a hard fix (real container/gVisor/Firecracker sandbox + auth/rate-limiting on the public path), not a like-for-like port.

Other business-rule notes: scoring formula differs by question type (MCQ/TECHNICAL/BOTH, different weightings); anti-cheat auto-terminates on `tabSwitchCount >= 2` computed **server-side**, not trusted from the client (good pattern, keep it); test expiry is derived live from `createdAt + expiryDays`, not stored/cron-updated; question selection for a generated test shuffles in-memory per request with **no persisted "which questions were assigned" record** — retrying `/tests/public/start` with the same unused token may serve a different random question set (unverified whether the frontend prevents re-calling start; flag to confirm before the port assumes idempotent delivery).

## 2.11 Notifications

`/api/notifications` — paginated list GET is **Admin-only** (intentional per comment) despite the generic path name, while every other endpoint on the same controller (`unread-count`, `unread`, `type/{type}`, mark-read, read-all, delete) is open to any user scoped to self. Non-admins therefore have no way to see a paginated history of their own notifications, only unread/by-type/counts — worth confirming against the frontend/product expectation before the NestJS port assumes parity.

## 2.12 Cross-cutting findings from Part 2

| # | Finding | Severity | Where |
|---|---|---|---|
| 1 | `GET /api/documents/{id}` returns full file content with no permission/assignment check | High | `DocumentController.java:119-124` |
| 2 | Interview code-execution endpoints run untrusted code via raw `ProcessBuilder` with no sandbox; one path has no auth at all | High | `InterviewTestService.java:39-119`, `InterviewTestController.java:171-195` |
| 3 | `ApprovalService.validateApprover` never authorizes non-Admins — the modeled `T1_Lead` level is unreachable | Medium-High | `ApprovalService.java:180-190` |
| 4 | Ticket calendar endpoints have no auth check at all | Medium | `TicketController.java:273-393` |
| 5 | `GroupController.list/get` expose full membership with no auth check | Medium | `GroupController.java:24-32` |
| 6 | Watcher add/remove authorization is asymmetric | Low-Medium | `TicketWatcherController.java:41-69` vs `:73-86` |
| 7 | Seat booking has zero role checks anywhere, including an org-wide report endpoint | Low-Medium | `SeatBookingController.java` |
| 8 | Authorization pattern inconsistent across the whole scope (`@PreAuthorize` vs. manual helper vs. service-layer-only) | Medium (maintainability) | throughout |
| 9 | No recurring-calendar-event model exists on the backend | Informational | `TicketController.java:309` |
| 10 | No visible Spring counterpart to Laravel's Hour Tracking PDF export | Informational | absence |

---

# Part 3 — Password Manager & Policy Management + Full Flyway Migration Inventory

## 3.0 Controller-level authorization summary

| Controller | Base path | Class-level gate |
|---|---|---|
| `PasswordDashboardController` | `/api/password-manager` | none — per-method (`/dashboard` open, `/dashboard/org` Admin) |
| `PasswordEntryController` | `/api/password-entries` | `hasRole('Admin')` |
| `PasswordFolderController` | `/api/password-folders` | `hasRole('Admin')` |
| `PasswordPolicyController` | `/api/password-policies` | none — per-method (`list`/`apply`/`document-file` open, mutations Admin) |
| `PasswordSharingController` | `/api/password-entries` | `hasRole('Admin')` |
| `VaultGroupController` | `/api/vault-groups` | `hasRole('Admin')` |
| `VaultKeyController` | `/api/vault` | `hasRole('Admin')` (also covers vault MFA) |
| `VaultShareLinkController` | `/api/vault-share-links` | **none at all** — authentication only |
| `AuditLogController` | `/api/audit-logs` | none at class level; sole GET method-level Admin |

**`security-baseline.md`'s F1/F4 finding list (`JwtAuthFilter.java:70-73` affecting `PasswordEntryController`/`VaultKeyController`/`VaultGroupController`/`PasswordSharingController`/`PasswordFolderController`/`AuditLogController`) is accurate for those 6 — but `VaultShareLinkController` is not Admin-gated at all**, so the F1 role-escalation bug doesn't even apply to it (it never checked for Admin) — but that also means a plain `User`-role account already has full access to it today, inconsistent with its Admin-only siblings. A deliberate decision is needed for the rewrite's route-authorization matrix (R-10).

## 3.1 Endpoint & field detail by controller

**`PasswordDashboardController`** — `GET /dashboard` (any user, counts/metadata only) and `GET /dashboard/org` (Admin, "counts/metadata only, never decrypts").

**`PasswordEntryController`** — list/create/update/favorite/archive/delete/restore/purge/history/history-restore. List response deliberately excludes ciphertext fields. **`GET /{id}/reveal`** is the only endpoint returning ciphertext for decryption — and it is a **GET** (`:57`, `PasswordEntryService.reveal():213`) — the backend-side instance of the same anti-pattern `security-baseline.md`'s V-F19/R-26 already flags against the Laravel route; R-26 (reveal must be POST, `Cache-Control: no-store`) applies directly to this endpoint's NestJS replacement.

**`PasswordFolderController`** — metadata-only containers, no ciphertext.

**`PasswordPolicyController`** — CRUD (Admin) + `apply`/`document-file` (any user). All fields are plaintext admin metadata / rich-text policy content, nothing touches vault ciphertext.

**`PasswordSharingController`** — share/unshare carry only a client-wrapped Entry Key per grant, never plaintext/EK. Writes audit rows directly via `AuditLogRepository`, bypassing `AuditLogService`.

**`VaultGroupController`** — create/list/members/my-key/add-member/remove-member/delete. **Finding: no audit trail for vault group lifecycle at all** — `VaultGroupService.java` has zero references to `AuditLog`/`auditLogRepository`. Contradicts `security-baseline.md`'s P-10 ("full audit logging on every reveal/share/create/delete/purge") for this specific service.

**`VaultKeyController`** — key material (`/keys`, `/setup`, `/recovery-params`, `/recover`, `/public-keys`) + vault MFA (`/mfa/status,setup,confirm,verify,disable`). **Finding: no audit trail for vault key lifecycle either** — `VaultKeyService.java` has no `AuditLogRepository` dependency at all; vault setup, master-password/recovery rotation, and every MFA setup/confirm/verify/disable call are entirely unaudited. Since this controller gates the wrapped Vault Key itself — the exact surface `security-baseline.md`'s V-F3 calls "the only gate standing between an attacker and `GET /api/vault/keys`" — the missing audit trail on `disableMfa`/`confirmMfa`/`verifyMfa` is a real gap for R-34 ("an action that cannot be audited fails") to close, not just preserve. No server-side floor validation of `kdfParams` exists in `applyKeyMaterial()` — matches the already-documented open R-22 finding.

**`VaultShareLinkController`** — create/mine/shared-with-me/delete/meta/open. **Finding — anti-enumeration leak:** `VaultShareLinkService.meta()` (`:134-158`) returns `available:false` for both a nonexistent link and one belonging to a different recipient (body-shape-identical, matching its own comment's intent) — but the **`reason` field's value differs**: `"NOT_FOUND"` vs `"WRONG_RECIPIENT"` (`:137,142`). A caller can distinguish "doesn't exist" from "exists but isn't yours," which is exactly the enumeration oracle P-09/R-33 says must not exist. This is a genuine discrepancy between the code and its own comment, newly observed in this audit (not previously documented in `security-baseline.md`) — flag for whoever owns R-33/P-09 in the rewrite.

**`AuditLogController`** — scope confirmed **generic, not vault-only** (own comment: "first consumer is the Password Manager audit log page"). `AuditLogService` itself only has helpers for the Document module; every vault service that does audit (Entry, Sharing, ShareLink) bypasses it and writes `AuditLog` rows directly with its own ad hoc `entityType` string. `VaultGroupService`/`VaultKeyService` write none at all (see above). One shared `audit_logs` table (from `V1`) serves both document and vault events, filterable only by free-text `entity_type`, with two structurally different write paths. The NestJS/Prisma rewrite should treat `audit_logs` as a shared cross-module table from day one and decide whether to centralize all vault writes through one audit service — closing the `VaultGroupService`/`VaultKeyService` gaps — rather than carrying forward two patterns.

## 3.2 Opaque-ciphertext vs. plaintext-metadata classification (ZK-06/ZK-07 artifact)

| Entity | Opaque (server never parses) | Plaintext metadata |
|---|---|---|
| `PasswordEntry` | `secretCiphertext`, `secretIv`, `notesCiphertext`, `notesIv` | id, owner, group, folder, title, username, url, keyVersion, category, publicKey, strengthScore, expiresAt, reminder fields, favorite, archived/deleted timestamps, lastUsedAt, timestamps — `username`/`url`/`publicKey` are explicitly plaintext by design ("needed for list/search/autofill without a decrypt+audit round trip") |
| `PasswordEntryHistory` | `secretCiphertext`, `secretIv` | id, entry, keyVersion, changedBy, createdAt |
| `PasswordEntryKey` | `wrappedEntryKey`, `wrappedEntryKeyIv` | id, entry, user, group, wrapMethod, createdAt |
| `PasswordEntryShare` | *(none)* | id, entry, sharedWith, permission, sharedBy, createdAt |
| `UserVaultKey` | `wrappedVk`/`Iv`, `wrappedVkRecovery`/`Iv`, `wrappedPrivateKey`/`Iv`, `mfaSecret` (server-held TOTP secret by necessity, not vault content) | id, user, kdfSalt, kdfParams, recoverySalt, recoveryKdfParams, publicKey, recoveryKeyGeneratedAt, mfa flags/timestamps |
| `VaultGroup` | *(none)* | id, name, description, createdBy, timestamps |
| `VaultGroupMember` | `wrappedGroupKey`, `Iv` | id, group, user, role, addedBy, createdAt |
| `VaultShareLink` | `wrappedEntryKey`, `Iv` | id, entry, recipient, createdBy, maxViews, viewCount, expiresAt, revokedAt, createdAt |
| `PasswordPolicy` | *(none — not vault content)* | all fields incl. `documentContent` (sanitized HTML) and `documentFileData` (attachment, not secret) |
| `AuditLog` | *(none)* | all fields — `beforeData`/`afterData` JSONB carry metadata only, never ciphertext, on every vault write path |

Copy/adapt this table into the rewrite's own schema-classification doc rather than re-deriving it.

## 3.3 Full Flyway migration inventory

`src/main/resources/db/migration/` contains **75 files total: 73 real Flyway migrations `V1`-`V73` with no gaps**, plus 2 non-Flyway files that must **not** be fed into any `prisma db pull` expectations:
- **`TicketApp_backup.sql`** — a raw `pg_dump` snapshot; defines schema objects (a `_migrations` table, an `update_updated_at_column()` trigger) that no Flyway migration here creates — reference only, never a schema source of truth.
- **`all.sql`** — a stale "V1 through V19" consolidation, not maintained past V19.

**Blueprint accuracy note:** the blueprint's "~74 migrations" figure is off by one (73 real ones); the Prisma introspection target should be a database with exactly `V1`-`V73` applied via Flyway (check `flyway_schema_history`), not one seeded from either non-Flyway file.

| # | Migration | Summary |
|---|---|---|
| V1 | `V1__initial_schema.sql` | Initial schema: roles, domains, users, sessions, tickets, ticket_approvals, ticket_comments, ticket_attachments, assignments, audit_logs, user_activity, analytics_aggregates + indexes. |
| V2 | `V2__seed_data.sql` | Seeds Admin/User roles, 6 domains, 4 predefined users. |
| V3 | `V3__add_daily_reports.sql` | Adds `users.daily_reports JSONB`. |
| V4 | `V4__add_missing_indexes.sql` | Ticket/comment partial indexes + unique `ticket_approvals(ticket_id, level_order)`. |
| V5 | `V5__add_ticket_attachments.sql` | Adds `tickets.attachments JSONB`. |
| V6 | `V6__seat_booking.sql` | New Seat Booking module: rooms, seats, seat_reservations + seed data. |
| V7 | `V7__add_ticket_extra_fields.sql` | Adds ticket_number+sequence, severity/reproducibility/view_status/resolution fields; `users.employee_id`. |
| V8 | `V8__add_ticket_relationships.sql` | New `ticket_relationships` table. |
| V9 | `V9__add_ticket_watchers.sql` | New `ticket_watchers` join table. |
| V10 | `V10__add_projects_categories.sql` | New projects/project_categories; `tickets.project_id`; seeds 9 projects. |
| V11 | `V11__add_reminders.sql` | New `reminders` table. |
| V12 | `V12__rename_seats_sequential.sql` | Data migration: renumbers cube seat labels to sequential 1-20. |
| V13 | `V13__unique_room_names.sql` | Dedupes rooms by name, reassigns FKs, unique constraint on `room_name`. |
| V14 | `V14__add_round_table_room.sql` | Widens `rooms.type` check; seeds one room. |
| V15 | `V15__add_documents_table.sql` | New `documents` table. |
| V16 | `V16__add_document_views.sql` | New `document_views` table. |
| V17 | `V17__add_interview_tables.sql` | New Interview module tables (questions, question sets, submissions, results, violations). |
| V18 | `V18__seed_interview_questions.sql` | Seeds MCQ/technical questions. |
| V19 | `V19__add_review_tickets.sql` | Seeds "IT Reviews" project/categories; ticket indexes. |
| V20 | `V20__create_calendar_events_table.sql` | New calendar_events/settings/notifications/statistics; backfills; adds sync triggers (dropped later, V51). |
| V21 | `V21__add_document_type_and_template.sql` | Adds `documents.document_type, is_template, created_by`. |
| V22 | `V22__create_document_assignments.sql` | New `document_assignments`. |
| V23 | `V23__create_document_read_tracking.sql` | New `document_read_tracking`. |
| V24 | `V24__create_notifications.sql` | New `notifications` (type check widened repeatedly later — V59, V70, V72, V73). |
| V25 | `V25__fix_calendar_events_deleted_at_column.sql` | Fixes `deleted_at` type BOOLEAN→TIMESTAMPTZ, nulls unconvertible data. |
| V26 | `V26__document_policy_enhancements.sql` | Widens document_type check (+'policy'); `is_responsible`; indexes. |
| V27 | `V27__calendar_sla_sync.sql` | SLA index; backfills `calendar_events.start_date` from `sla_deadline`. |
| V28 | `V28__add_interview_generated_tests_tables.sql` | New generated_tests/generated_test_tokens (public link flow). |
| V29 | `V29__canonical_roles.sql` | Inserts/updates canonical Admin role row. |
| V30 | `V30__simplify_roles.sql` | **Destructive:** migrates all non-canonical-role users to Admin, deletes all roles except Admin/User. |
| V31 | `V31__add_guest_role.sql` | Re-introduces `Guest` role (Seat-Booking-only). **The DB-level origin of the V-F1 role-escalation bug** — see flag below. |
| V32 | `V32__add_ms_org_fields.sql` | Adds `users.ms_groups, ms_teams JSONB`. |
| V33 | `V33__add_job_title.sql` | Adds `users.job_title`. |
| V34 | `V34__add_graph_profile_fields.sql` | Adds department/office_location/microsoft_oid; widens avatar_url. |
| V35 | `V35__allow_hard_delete_users.sql` | Relaxes FK rules on `users(id)` refs for hard-delete. **Silently no-opped in production** — see V41. |
| V36 | `V36__domain_ticket_prefix.sql` | Adds domains.code/ticket_seq; renumbers tickets to per-domain prefixed format. |
| V37 | `V37__ticket_dates_and_approval_forward.sql` | Adds start_date/due_date; `ticket_approvals.forwarded_to_id`. |
| V38 | `V38__comment_attachments.sql` | Adds `ticket_comments.attachments JSONB`. |
| V39 | `V39__ticket_teams.sql` | Adds `tickets.teams JSONB`. |
| V40 | `V40__categories.sql` | New `categories`; seeds+backfills legacy values. |
| V41 | `V41__fix_hard_delete_user_fks.sql` | **Fixes V35**, which referenced a nonexistent table and rolled back its whole transaction silently; redoes the FK relaxation defensively. |
| V42 | `V42__backfill_domain_code.sql` | Defensive backfill of `domains.code` in case V36 didn't fully apply. |
| V43 | `V43__user_domains_many_to_many.sql` | New `user_domains` join table; backfills; **drops `users.domain_id`**. |
| V44 | `V44__employee_id_edit_limit.sql` | Adds `users.employee_id_edit_count`. |
| V45 | `V45__board_config.sql` | New `board_config` (global Kanban config, single shared row). |
| V46 | `V46__notification_email_log.sql` | New outbound email audit trail. |
| V47 | `V47__sla_config.sql` | New global SLA timing config. |
| V48 | `V48__user_theme_preference.sql` | Adds `users.theme_preference`. |
| V49 | `V49__add_comment_mentions.sql` | Adds `ticket_comments.mentioned_user_ids JSONB`. |
| V50 | `V50__add_ticket_mentions.sql` | Same feature, extended to ticket descriptions. |
| V51 | `V51__drop_calendar_event_ticket_triggers.sql` | **Drops** the V20 sync triggers (raced with app-layer sync code). |
| V52 | `V52__create_groups.sql` | New `user_groups, user_group_members` (general-purpose, distinct from Vault Groups/V66). |
| V53 | `V53__add_seat_label_to_reservations.sql` | Adds `seat_label`. |
| V54 | `V54__add_ticket_on_behalf_of.sql` | Adds `on_behalf_of_user_id`. |
| V55 | `V55__create_hour_tracking_module.sql` | New Hour Tracking module (teams, team_members, projects, tickets, logs — independent of the ticket-raise model). |
| **V56** | `V56__create_password_manager_module.sql` | **Password Manager module created**: password_folders, password_entries (ciphertext/IV NOT NULL, notes nullable, key_version), password_entry_history, password_entry_shares. Audit reuses existing `audit_logs`. |
| V57 | `V57__fix_password_manager_column_types.sql` | Widens key_version/strength_score SMALLINT→INTEGER. |
| V58 | `V58__password_manager_key_mgmt_and_reminders.sql` | Adds public_key (SSH Key Mgmt), reminder fields. |
| V59 | `V59__widen_notifications_type_check.sql` | Widens type check (+password_expiry, password_shared, etc). |
| V60 | `V60__create_password_policies.sql` | New `password_policies` (Policy Management). |
| V61 | `V61__password_policy_documents.sql` | Adds `document_content`. |
| V62 | `V62__password_policy_document_file.sql` | Adds document_file_name/type/data. |
| V63 | `V63__ai_chat_litellm.sql` | AI Chat module — out of vault scope. |
| V64 | `V64__ai_chat_team_models_and_members.sql` | AI Chat — out of vault scope. |
| **V65** | `V65__create_vault_key_management.sql` | **Zero-knowledge vault key mgmt created**: user_vault_keys (KDF salt/params, wrapped VK/recovery-VK, wrapped RSA private key), password_entry_keys. |
| **V66** | `V66__create_vault_groups.sql` | **Vault Groups created**: vault_groups, vault_group_members (wrapped Group Key/member); adds group_id to entries/entry_keys + exactly-one-of check constraint. |
| V67 | `V67__add_user_token_version.sql` | Adds `users.token_version` (JWT revocation on role change — P-16). |
| **V68** | `V68__add_vault_mfa.sql` | Adds vault-specific TOTP (`mfa_secret, mfa_enabled, mfa_verified_at`) — independent of portal login MFA. |
| **V69** | `V69__create_vault_send.sql` | New `vault_send` — anonymous possession-based sharing. **Orphaned — see flag below.** |
| V70 | `V70__add_vaultsend_viewed_notification_type.sql` | Widens type check (+vaultsend_viewed). |
| V71 | `V71__create_resolution_notes.sql` | New `resolution_notes` — out of vault scope. |
| **V72** | `V72__create_vault_share_link.sql` | **New `vault_share_link`** — identity-bound sharing, explicitly "replaces the anonymous Vault Send model." |
| V73 | `V73__add_document_replaced_notification_type.sql` | Widens type check again (+document_replaced, document_due_reminder). |

### Flagged migrations — for the Prisma introspection step

1. **`vault_send` (V69) is dead/orphaned schema.** `VaultShareLink.java`'s own javadoc says the anonymous Vault Send model "was removed: this org has no use case for sharing with someone outside the organization" — a repo-wide grep for `VaultSend`/`vault_send` in `src/main/java` returns **zero matches**, and **no migration ever drops the table**. `prisma db pull` will introspect it as a live table with no application code behind it. This needs an explicit human decision (model as dead vs. write a drop migration) rather than a silent carry-forward — exactly the kind of migration-vs-current-code mismatch the blueprint's introspect-don't-hand-model approach exists to catch.
2. **V51 explicitly drops DDL V20 created** (the calendar-events auto-sync triggers) due to a race with application-layer sync — a deliberate, documented undo, the one clear case of a migration reversing an earlier migration's DDL.
3. **V41 fixes V35, which silently no-opped in production** because it referenced a table Flyway never created — a real historical footgun: reading V35's SQL alone would give a false impression of what actually happened in a real database. This is the concrete justification for the blueprint's "introspect from a real staging copy" approach over reading migration files and assuming they applied.
4. **V31 is the schema-level origin of the `JwtAuthFilter.java:70-73` V-F1 finding** — the `Guest` role's actual DB-defined permissions (seats:read/book, rooms:read/book only) confirm it was deliberately scoped to Seat Booking only, making the JWT filter's blanket escalation-to-Admin unambiguously wrong rather than an edge case.
5. **No migration weakens the zero-knowledge guarantee.** Every vault-related migration that adds a secret-adjacent column consistently pairs `*_ciphertext`/`wrapped_*` with its `*_iv` sibling. `mfa_secret` (V68) is the one column that could look suspicious at a glance but is a standard server-readable TOTP secret, explicitly documented as "not vault content," matching `UserVaultKey.java`'s `@JsonIgnore` treatment. No plaintext password/master-password/VK column exists in any migration.

---

# Cross-cutting findings — consolidated, severity-ranked

| Severity | Finding | Where | Part |
|---|---|---|---|
| **Critical (new, not previously documented)** | Interview code-execution runs untrusted source via raw `ProcessBuilder` on the API host with zero sandboxing; the public entry point (`/tests/public/run-code`) requires no authentication and no test token at all | `InterviewTestService.java:39-119`, `InterviewTestController.java:171-195` | 2 |
| **High (new)** | `GET /api/documents/{id}` returns full file bytes with no permission/assignment check, while every write path on the same resource is properly Admin-gated | `DocumentController.java:119-124` | 2 |
| **High (confirms existing V-F1/F4)** | Non-canonical roles (incl. the DB-seeded `Guest` role) fail open to `ROLE_Admin` | `JwtAuthFilter.java:70-73`; DB origin at `V31` | 1, 3 |
| **Medium (new)** | Two of the six Admin-gated vault controllers write **zero** audit-log rows (`VaultGroupService`, `VaultKeyService`) — including MFA setup/confirm/verify/disable on the one endpoint that gates the wrapped Vault Key itself | `VaultGroupController`/`VaultKeyController` scope | 3 |
| **Medium (new)** | `VaultShareLinkController` carries no Admin gate at all — inconsistent with its five sibling vault controllers | `VaultShareLinkController.java` | 3 |
| **Medium (new)** | `VaultShareLinkService.meta()`'s anti-enumeration response is body-shape-identical but leaks `NOT_FOUND` vs `WRONG_RECIPIENT` in its `reason` field | `VaultShareLinkService.java:134-158` | 3 |
| **Medium (new)** | `ApprovalService.validateApprover` never authorizes non-Admins — the modeled `T1_Lead` approval level is unreachable by anyone but Admin | `ApprovalService.java:180-190` | 2 |
| **Medium (new)** | `vault_send` table (V69) is dead/orphaned — no application code references it and no migration drops it; will surface in Prisma introspection with no code behind it | `V69__create_vault_send.sql` vs. `VaultShareLink.java:14-16` | 3 |
| **Medium (new)** | Ticket calendar endpoints and `GroupController.list/get` have no auth checks at all | `TicketController.java:273-393`, `GroupController.java:24-32` | 2 |
| **Low-Medium (new)** | Seat Booking has zero role checks anywhere including an org-wide `/report` endpoint; watcher add/remove authorization is asymmetric | `SeatBookingController.java`, `TicketWatcherController.java` | 2 |
| **Low (new)** | `Service2ProxyController`'s one route has authentication only, no admin/role check | `Service2ProxyController.java` | 1 |
| **Informational (new)** | No recurring-event model exists on the backend at all; Hour Tracking PDF export has no visible Spring counterpart; `Service2Client`'s real base URL is unset (runs on a hardcoded localhost default); `app.claude.api-key`/`openrouter.api.key` are dead config; Microsoft login is hand-rolled, not MSAL — plan the NestJS auth port accordingly | throughout | 1, 2 |

All items above marked **(confirms existing)** were already tracked in `security-baseline.md`; everything marked **(new)** was surfaced by this audit and is not yet reflected there. Whoever next updates `security-baseline.md`'s requirements list (R-nn numbering) should fold these in — the Interview sandbox and unauthenticated document endpoint in particular are release blockers on par with the already-documented V-F1.
