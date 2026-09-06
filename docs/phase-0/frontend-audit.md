# Frontend Audit — OrgPortalFrontend (Laravel 11 / Blade)

**Audit target:** `C:\Users\Sandhosh\OneDrive - Promon Software Solution\Desktop\Apps\OrgPortalFrontend`
**Purpose:** source of truth for the Next.js 14 (App Router) + React + TypeScript + Tailwind rewrite.
**Method:** every file cited below was read. All line references are to the audited repo. No secret values are reproduced — env keys are named only.

## Stack facts (grounded)

| Fact | Evidence |
|---|---|
| Laravel 11, PHP ^8.2 | `composer.json` — `"laravel/framework": "^11.0"`, `"php": "^8.2"` |
| Server-rendered Blade only — no npm, no Vite, no bundler | no `package.json`, no `resources/js`, no `vite.config.js` in repo |
| PDF generation server-side | `composer.json` — `"barryvdh/laravel-dompdf": "^3.1"` |
| HTTP client to backend | `composer.json` — `"guzzlehttp/guzzle": "^7.2"` via Laravel's `Http` facade |
| `laravel/sanctum` installed but unused | `composer.json`; no Sanctum guard/middleware referenced in `bootstrap/app.php` |
| 92 Blade files, 1 layout, 13 app-owned JS files, 7 CSS files | `resources/views/**`, `public/js/*.js`, `public/css/*.css` |
| Route file count: **1** | `routes/web.php` only (386 lines). No `routes/api.php`, no `routes/console.php`, no `routes/channels.php` — **not present** |
| Registered route files | `bootstrap/app.php:9-12` — `web: routes/web.php`, `health: '/up'` |

---

# 1. Complete route inventory

Every route in `routes/web.php` (the only route file). `bootstrap/app.php:9-12` registers it plus a Laravel-generated health route `GET /up`.

**Global middleware appended to every `web` route** (`bootstrap/app.php:23-27`), in order:
`SecurityHeaders` → `PreventBackHistoryCache` → `StripDisallowedGlyphs`, on top of Laravel's default `web` group (session, CSRF, cookie encryption).

**Aliases** (`bootstrap/app.php:14-19`):
`auth.jwt` → `JwtAuth`, `guest.access` → `GuestAccess`, `admin` → `AdminOnly`, `ai-chat.access` → `AiChatAccess`.

Middleware column below shows only route-specific middleware **on top of** the global set. `[G]` = inside the `['auth.jwt','guest.access']` group (`routes/web.php:48`). `[G+A]` = additionally inside a `Route::middleware('admin')` group.

## 1.1 Public routes (no auth)

| Method | URI | Controller@action | Middleware | Route name | View rendered | → Next.js App Router path |
|---|---|---|---|---|---|---|
| GET | `/login` | `AuthController@showLogin` | — | `login` | `auth.login` (`AuthController.php:19`) | `app/(auth)/login/page.tsx` |
| POST | `/login` | `AuthController@login` | `throttle:10,1` | `login.post` | redirect | Server Action / `app/api/auth/login/route.ts` |
| GET | `/register` | `AuthController@showRegister` | — | `register` | `auth.register` (`AuthController.php:63`) | `app/(auth)/register/page.tsx` |
| POST | `/register` | `AuthController@register` | `throttle:5,1` | `register.post` | redirect | Server Action |
| GET | `/auth/microsoft` | `AuthController@redirectToMicrosoft` | — | `auth.microsoft` | 302 to backend | `app/api/auth/microsoft/route.ts` (redirect) |
| GET | `/auth/microsoft/callback` | `AuthController@microsoftCallback` | — | `auth.microsoft.callback` | redirect | `app/api/auth/microsoft/callback/route.ts` |
| POST | `/logout` | `AuthController@logout` | — | `logout` | redirect | `app/api/auth/logout/route.ts` |
| GET | `/interview/take-test` | `InterviewController@takeTest` | — | `interview.take-test` | `interview.take-test` (`InterviewController.php:216`) | `app/(public)/interview/take-test/page.tsx` |
| POST | `/interview/public-api/validate-token` | `InterviewController@publicValidateToken` | `throttle:10,1` | `interview.public.validate-token` | JSON | `app/api/interview/public/validate-token/route.ts` |
| POST | `/interview/public-api/start` | `InterviewController@publicStartTest` | — | `interview.public.start` | JSON | `app/api/interview/public/start/route.ts` |
| POST | `/interview/public-api/run-code` | `InterviewController@publicRunCode` | `throttle:10,1` | `interview.public.run-code` | JSON | `app/api/interview/public/run-code/route.ts` |
| POST | `/interview/public-api/submit` | `InterviewController@publicSubmitTest` | — | `interview.public.submit` | JSON | `app/api/interview/public/submit/route.ts` |
| POST | `/interview/public-api/log-violation` | `InterviewController@publicLogViolation` | — | `interview.public.log-violation` | JSON | `app/api/interview/public/log-violation/route.ts` |
| GET | `/html-runner` | closure `return view('html-runner')` (`web.php:43-45`) | — | `html-runner` | `html-runner` | `app/(tools)/html-runner/page.tsx` |
| GET | `/up` | Laravel health closure | — | *(none)* | JSON | `app/api/health/route.ts` |

## 1.2 Home / Dashboard / Tickets / Calendar

| Method | URI | Controller@action | MW | Name | View | → Next.js |
|---|---|---|---|---|---|---|
| GET | `/home` | `HomeController@index` | [G] | `home` | `home` (`HomeController.php:11`) | `app/(portal)/home/page.tsx` |
| GET | `/` | `DashboardController@index` | [G] | `dashboard` | `dashboard.index` (`DashboardController.php:135`) | `app/(portal)/page.tsx` |
| GET | `/api/dashboard/board-tickets` | `DashboardController@boardTickets` | [G] | `api.dashboard.board-tickets` | JSON | `app/api/dashboard/board-tickets/route.ts` |
| GET | `/api/dashboard/board-config` | `DashboardController@boardConfig` | [G] | `api.dashboard.board-config` | JSON | `app/api/dashboard/board-config/route.ts` |
| PUT | `/api/dashboard/board-config` | `DashboardController@saveBoardConfig` | [G] | `api.dashboard.board-config.save` | JSON | same route file, `PUT` handler |
| GET | `/tickets` | `TicketController@index` | [G] | `tickets.index` | `tickets.index` (`TicketController.php:81`) | `app/(portal)/tickets/page.tsx` |
| GET | `/tickets/create` | `TicketController@create` | [G] | `tickets.create` | `tickets.create` (`TicketController.php:108`) | `app/(portal)/tickets/create/page.tsx` |
| POST | `/tickets` | `TicketController@store` | [G] | `tickets.store` | redirect | Server Action |
| GET | `/tickets/my-view` | `TicketController@myView` | [G] | `tickets.my-view` | `tickets.my-view` (`TicketController.php:636`) | `app/(portal)/tickets/my-view/page.tsx` |
| GET | `/tickets/mine` | `TicketController@myCreated` | [G] | `tickets.my-created` | `tickets.my-created` (`TicketController.php:680,691`) | `app/(portal)/tickets/mine/page.tsx` |
| GET | `/tickets/relationship-search` | `TicketController@relationshipSearch` | [G] | `tickets.relationship.search` | JSON | `app/api/tickets/relationship-search/route.ts` |
| GET | `/tickets/calendar` | `CalendarController@index` | [G] | `tickets.calendar` | `tickets.calendar` (`CalendarController.php:57`) | `app/(portal)/tickets/calendar/page.tsx` |
| GET | `/api/calendar/events` | `CalendarController@getEvents` | [G] | `api.calendar.events` | JSON | `app/api/calendar/events/route.ts` |
| GET | `/api/calendar/statistics` | `CalendarController@getStatistics` | [G] | `api.calendar.statistics` | JSON | `app/api/calendar/statistics/route.ts` |
| GET | `/tickets/{id}` | `TicketController@show` | [G] | `tickets.show` | `tickets.show` (`TicketController.php:260`) | `app/(portal)/tickets/[id]/page.tsx` |
| GET | `/tickets/{id}/edit` | `TicketController@edit` | [G] | `tickets.edit` | `tickets.edit` (`TicketController.php:356`) | `app/(portal)/tickets/[id]/edit/page.tsx` |
| PATCH | `/tickets/{id}` | `TicketController@update` | [G] | `tickets.update` | redirect | Server Action |
| PATCH | `/tickets/{id}/status` | `TicketController@updateStatus` | [G] | `tickets.status` | redirect/JSON | Server Action |
| PATCH | `/tickets/{id}/assign` | `TicketController@assign` | [G] | `tickets.assign` | redirect/JSON | Server Action |
| DELETE | `/tickets/{id}` | `TicketController@destroy` | [G] | `tickets.destroy` | redirect | Server Action |
| POST | `/tickets/{id}/comments` | `TicketController@addComment` | [G] | `tickets.comment` | redirect | Server Action |
| PATCH | `/tickets/{id}/comments/{commentId}` | `TicketController@updateComment` | [G] | `tickets.comment.update` | redirect | Server Action |
| POST | `/tickets/{id}/approve` | `TicketController@approve` | [G] | `tickets.approve` | redirect | Server Action |
| POST | `/tickets/{id}/reject` | `TicketController@reject` | [G] | `tickets.reject` | redirect | Server Action |
| GET | `/tickets/{id}/watchers` | `TicketController@watchers` | [G] | `tickets.watchers.index` | JSON | `app/api/tickets/[id]/watchers/route.ts` |
| POST | `/tickets/{id}/watchers` | `TicketController@addWatcher` | [G] | `tickets.watchers.store` | JSON | same route file |
| DELETE | `/tickets/{id}/watchers/{userId}` | `TicketController@removeWatcher` | [G] | `tickets.watchers.destroy` | JSON | `app/api/tickets/[id]/watchers/[userId]/route.ts` |
| POST | `/tickets/{id}/relationships` | `TicketController@addRelationship` | [G] | `tickets.relationship.add` | JSON | `app/api/tickets/[id]/relationships/route.ts` |
| DELETE | `/tickets/{id}/relationships/{rid}` | `TicketController@deleteRelationship` | [G] | `tickets.relationship.delete` | JSON | `.../relationships/[rid]/route.ts` |
| POST | `/tickets/{id}/reminders` | `TicketController@addReminder` | [G] | `tickets.reminder.add` | JSON | `app/api/tickets/[id]/reminders/route.ts` |

> **Route-order hazard to preserve:** `web.php:107,115,120` carry explicit comments that `/tickets/create`, `/tickets/my-view`, `/tickets/mine`, `/tickets/relationship-search` and `/tickets/calendar` MUST be declared before `/tickets/{id}`. Next.js App Router resolves static segments before dynamic ones automatically, so this hazard disappears — but `/tickets/calendar` lives under `CalendarController`, not `TicketController`, which is easy to lose.

## 1.3 Approvals / Analytics / Reports

| Method | URI | Controller@action | MW | Name | View | → Next.js |
|---|---|---|---|---|---|---|
| GET | `/approvals` | `ApprovalsController@index` | [G] | `approvals.index` | `approvals.index` (`ApprovalsController.php:78`) | `app/(portal)/approvals/page.tsx` |
| GET | `/analytics` | `AnalyticsController@index` | [G] | `analytics.index` | `analytics.index` (`AnalyticsController.php:20`) | `app/(portal)/analytics/page.tsx` |
| GET | `/reports` | `ReportController@index` | [G] | `reports.index` | `reports.index` (`ReportController.php:125`) | `app/(portal)/reports/page.tsx` |

## 1.4 Hour Tracking

| Method | URI | Controller@action | MW | Name | View | → Next.js |
|---|---|---|---|---|---|---|
| GET | `/hour-tracking` | `HourTrackingController@index` | [G] | `hour-tracking.index` | `hour-tracking.log` (`HourTrackingController.php:32`) | `app/(portal)/hour-tracking/page.tsx` |
| GET | `/hour-tracking/log` | `HourTrackingController@log` | [G] | `hour-tracking.log` | **redirect** to `hour-tracking.index` (`HourTrackingController.php:44`) | keep as `redirect()` in `app/(portal)/hour-tracking/log/page.tsx` |
| GET | `/hour-tracking/reports` | `HourTrackingController@reports` | [G] | `hour-tracking.reports` | `hour-tracking.reports` (`:178`) | `app/(portal)/hour-tracking/reports/page.tsx` |
| GET | `/hour-tracking/reports/pdf` | `HourTrackingController@exportPdf` | [G] | `hour-tracking.reports.pdf` | `hour-tracking.reports-pdf` via `Pdf::loadView` (`:548`) | `app/api/hour-tracking/reports/pdf/route.ts` |
| GET | `/hour-tracking/team` | `HourTrackingController@teamView` | [G] | `hour-tracking.team` | `hour-tracking.team-reports` (`:352`) | `app/(portal)/hour-tracking/team/page.tsx` |
| GET | `/hour-tracking/team/pdf` | `HourTrackingController@teamExportPdf` | [G] | `hour-tracking.team.pdf` | `hour-tracking.team-reports-pdf` (`:473`) | `app/api/hour-tracking/team/pdf/route.ts` |
| PATCH | `/hour-tracking/team/{userId}/daily-report` | `HourTrackingController@updateTeamDailyReport` | [G] | `hour-tracking.team.daily-report.update` | JSON/redirect | Server Action |
| GET | `/hour-tracking/settings` | `HourTrackingController@settings` | [G] | `hour-tracking.settings` | `hour-tracking.settings` (`:213`) | `app/(portal)/hour-tracking/settings/page.tsx` |
| POST | `/hour-tracking/settings/domains` | `@storeDomain` | [G] | `hour-tracking.settings.domains.store` | redirect `?tab=domains` (`:226`) | Server Action |
| PATCH | `/hour-tracking/settings/domains/{id}` | `@updateDomain` | [G] | `hour-tracking.settings.domains.update` | redirect (`:239`) | Server Action |
| DELETE | `/hour-tracking/settings/domains/{id}` | `@deleteDomain` | [G] | `hour-tracking.settings.domains.delete` | redirect (`:245`) | Server Action |
| POST | `/hour-tracking/settings/projects` | `@storeProject` | [G] | `hour-tracking.settings.projects.store` | redirect (`:257`) | Server Action |
| POST | `/hour-tracking/settings/projects/{id}/categories` | `@storeCategory` | [G] | `hour-tracking.settings.categories.store` | redirect (`:267`) | Server Action |
| DELETE | `/hour-tracking/settings/projects/{pid}/categories/{cid}` | `@deleteCategory` | [G] | `hour-tracking.settings.categories.delete` | redirect (`:273`) | Server Action |
| DELETE | `/hour-tracking/settings/projects/{id}` | `@deleteProject` | [G] | `hour-tracking.settings.projects.delete` | redirect (`:282`) | Server Action |
| GET | `/hour-tracking/manage` | `HourTrackingSettingsController@index` | [G] | `hour-tracking.manage.index` | `hour-tracking.manage.index` (`:74`) — tabbed `?tab=teams\|projects\|tickets` | `app/(portal)/hour-tracking/manage/page.tsx` (searchParam `tab`) |
| POST | `/hour-tracking/manage/teams` | `@storeTeam` | [G] | `hour-tracking.manage.teams.store` | redirect | Server Action |
| PATCH | `/hour-tracking/manage/teams/{id}` | `@updateTeam` | [G] | `hour-tracking.manage.teams.update` | redirect | Server Action |
| DELETE | `/hour-tracking/manage/teams/{id}` | `@deleteTeam` | [G] | `hour-tracking.manage.teams.delete` | redirect | Server Action |
| POST | `/hour-tracking/manage/teams/{id}/members` | `@addTeamMember` | [G] | `hour-tracking.manage.teams.members.add` | redirect | Server Action |
| DELETE | `/hour-tracking/manage/teams/{id}/members/{userId}` | `@removeTeamMember` | [G] | `hour-tracking.manage.teams.members.remove` | redirect | Server Action |
| POST | `/hour-tracking/manage/projects` | `@storeProject` | [G] | `hour-tracking.manage.projects.store` | redirect | Server Action |
| PATCH | `/hour-tracking/manage/projects/{id}` | `@updateProject` | [G] | `hour-tracking.manage.projects.update` | redirect | Server Action |
| DELETE | `/hour-tracking/manage/projects/{id}` | `@deleteProject` | [G] | `hour-tracking.manage.projects.delete` | redirect | Server Action |
| POST | `/hour-tracking/manage/tickets` | `@storeTicket` | [G] | `hour-tracking.manage.tickets.store` | redirect | Server Action |
| PATCH | `/hour-tracking/manage/tickets/{id}` | `@updateTicket` | [G] | `hour-tracking.manage.tickets.update` | redirect | Server Action |
| DELETE | `/hour-tracking/manage/tickets/{id}` | `@deleteTicket` | [G] | `hour-tracking.manage.tickets.delete` | redirect | Server Action |
| GET | `/hour-tracking/projects` | `HourTrackingSettingsController@projectsBoard` | [G] | `hour-tracking.dashboard.projects` | `hour-tracking.dashboard.projects` (`:265`) | `app/(portal)/hour-tracking/projects/page.tsx` |
| GET | `/hour-tracking/projects/{id}` | `@projectBoardDetail` | [G] | `hour-tracking.dashboard.project-detail` | `hour-tracking.dashboard.project-detail` (`:278`) | `app/(portal)/hour-tracking/projects/[id]/page.tsx` |
| GET | `/hour-tracking/log-entries` | `HourTrackingController@logEntries` | [G] | `hour-tracking.log-entries` | JSON | `app/api/hour-tracking/log-entries/route.ts` |
| POST | `/hour-tracking/log-entries` | `@storeLogEntry` | [G] | `hour-tracking.log-entries.store` | JSON | same route file |
| PATCH | `/hour-tracking/log-entries/{id}` | `@updateLogEntry` | [G] | `hour-tracking.log-entries.update` | JSON | `.../log-entries/[id]/route.ts` |
| DELETE | `/hour-tracking/log-entries/{id}` | `@deleteLogEntry` | [G] | `hour-tracking.log-entries.delete` | JSON | same |
| GET | `/hour-tracking/options/projects` | `@projectOptions` | [G] | `hour-tracking.options.projects` | JSON (cascading dropdown) | `app/api/hour-tracking/options/projects/route.ts` |
| GET | `/hour-tracking/options/tickets` | `@ticketOptions` | [G] | `hour-tracking.options.tickets` | JSON (cascading dropdown) | `app/api/hour-tracking/options/tickets/route.ts` |

> `web.php:71-74` documents that `.manage.*` was deliberately named to avoid colliding with the legacy `.settings.*` shared-domains/projects routes. **Both sets still exist and both are live.** The rewrite must keep both or make a deliberate, documented decision to drop the legacy set.

## 1.5 Settings (legacy project-only) + Admin Settings

| Method | URI | Controller@action | MW | Name | View | → Next.js |
|---|---|---|---|---|---|---|
| GET | `/settings/projects` | `SettingsController@projects` | [G] | `settings.projects` | `settings.projects` (`SettingsController.php:230`) | `app/(portal)/settings/projects/page.tsx` |
| POST | `/settings/projects` | `@storeProject` | [G] | `settings.projects.store` | redirect | Server Action |
| POST | `/settings/projects/{id}/categories` | `@storeCategory` | [G] | `settings.categories.store` | redirect | Server Action |
| PATCH | `/settings/projects/{pid}/categories/{cid}` | `@updateCategory` | [G] | `settings.categories.update` | redirect | Server Action |
| DELETE | `/settings/projects/{pid}/categories/{cid}` | `@deleteCategory` | [G] | `settings.categories.delete` | redirect | Server Action |
| DELETE | `/settings/projects/{id}` | `@deleteProject` | [G] | `settings.projects.delete` | redirect | Server Action |
| GET | `/admin/settings` | `SettingsController@index` | [G] | `admin.settings` | `admin.settings` (`SettingsController.php:64`) | `app/(portal)/admin/settings/page.tsx` |
| POST | `/admin/settings/roles` | `@storeRole` | [G] | `admin.settings.roles.store` | redirect | Server Action |
| PATCH | `/admin/settings/roles/{id}` | `@updateRole` | [G] | `admin.settings.roles.update` | redirect | Server Action |
| DELETE | `/admin/settings/roles/{id}` | `@deleteRole` | [G] | `admin.settings.roles.delete` | redirect | Server Action |
| POST | `/admin/settings/domains` | `@storeDomain` | [G] | `admin.settings.domains.store` | redirect | Server Action |
| PATCH | `/admin/settings/domains/{id}` | `@updateDomain` | [G] | `admin.settings.domains.update` | redirect | Server Action |
| DELETE | `/admin/settings/domains/{id}` | `@deleteDomain` | [G] | `admin.settings.domains.delete` | redirect | Server Action |
| POST | `/admin/settings/resolution-notes` | `@storeResolutionNote` | [G] | `admin.settings.resolution-notes.store` | redirect | Server Action |
| PATCH | `/admin/settings/resolution-notes/{id}` | `@updateResolutionNote` | [G] | `admin.settings.resolution-notes.update` | redirect | Server Action |
| DELETE | `/admin/settings/resolution-notes/{id}` | `@deleteResolutionNote` | [G] | `admin.settings.resolution-notes.delete` | redirect | Server Action |
| POST | `/admin/settings/categories` | `@storeGlobalCategory` | [G] | `admin.settings.category.store` | redirect | **Legacy/unreachable** — see note |
| PATCH | `/admin/settings/categories/{id}` | `@updateGlobalCategory` | [G] | `admin.settings.category.update` | redirect | Legacy/unreachable |
| DELETE | `/admin/settings/categories/{id}` | `@deleteGlobalCategory` | [G] | `admin.settings.category.delete` | redirect | Legacy/unreachable |
| POST | `/admin/settings/projects` | `@storeProject` | [G] | `admin.settings.projects.store` | redirect | Server Action |
| PATCH | `/admin/settings/projects/{id}` | `@updateProject` | [G] | `admin.settings.projects.update` | redirect | Server Action |
| DELETE | `/admin/settings/projects/{id}` | `@deleteProject` | [G] | `admin.settings.projects.delete` | redirect | Server Action |
| PUT | `/admin/settings/sla` | `@saveSla` | [G] | `admin.settings.sla.save` | redirect | Server Action |

> **Important:** the `/admin/settings/*` routes are inside the `['auth.jwt','guest.access']` group only — they are **NOT** inside the `admin` middleware group (which starts at `web.php:210`, after these). `web.php:160-161` says the global-categories routes are "kept (unreachable from the UI) so nothing 404s if hit directly". Admin authorization on `/admin/settings` is therefore backend-only. **Do not silently "fix" this in the rewrite without a decision** — see §11.

## 1.6 Seat Booking

| Method | URI | Controller@action | MW | Name | View | → Next.js |
|---|---|---|---|---|---|---|
| GET | `/seat-booking` | `SeatBookingController@index` | [G] | `seat-booking.index` | `seat-booking.index` (`:24`) | `app/(portal)/seat-booking/page.tsx` |
| POST | `/seat-booking/book-seats` | `@bookSeats` | [G] | `seat-booking.book-seats` | redirect | Server Action |
| POST | `/seat-booking/book-room` | `@bookRoom` | [G] | `seat-booking.book-room` | redirect | Server Action |
| POST | `/seat-booking/cancel-by-code` | `@cancelByCode` | [G] | `seat-booking.cancel-code` | redirect | Server Action |
| GET | `/seat-booking/map` | `@seatMap` | [G] | `seat-booking.map` | `seat-booking.seat-map` (`:54`) | `app/(portal)/seat-booking/map/page.tsx` |
| GET | `/seat-booking/room-map` | `@roomMap` | [G] | `seat-booking.room-map` | `seat-booking.room-map` (`:112`) | `app/(portal)/seat-booking/room-map/page.tsx` |
| GET | `/seat-booking/api/reserved-seats` | `@apiReservedSeats` | [G] | `seat-booking.api.reserved-seats` | JSON | `app/api/seat-booking/reserved-seats/route.ts` |
| GET | `/seat-booking/api/seat-stats` | `@apiSeatStats` | [G] | `seat-booking.api.seat-stats` | JSON | `app/api/seat-booking/seat-stats/route.ts` |
| GET | `/seat-booking/api/rooms` | `@apiRooms` | [G] | `seat-booking.api.rooms` | JSON | `app/api/seat-booking/rooms/route.ts` |
| GET | `/seat-booking/api/reserved-rooms` | `@apiReservedRooms` | [G] | `seat-booking.api.reserved-rooms` | JSON | `app/api/seat-booking/reserved-rooms/route.ts` |
| GET | `/seat-booking/report` | `@report` | [G] | `seat-booking.report` | `seat-booking.report` (`:270`) — **admin enforced in controller, not middleware** (`web.php:193`) | `app/(portal)/seat-booking/report/page.tsx` |
| GET | `/seat-booking/report/pdf` | `@reportPdf` | [G] | `seat-booking.report.pdf` | `seat-booking.report-pdf` (`:279`) | `app/api/seat-booking/report/pdf/route.ts` |
| GET | `/seat-booking/report/excel` | `@reportExcel` | [G] | `seat-booking.report.excel` | file download | `app/api/seat-booking/report/excel/route.ts` |
| GET | `/seat-booking/settings` | `@settings` | [G] | `seat-booking.settings` | `seat-booking.settings` (`:362`) | `app/(portal)/seat-booking/settings/page.tsx` |
| POST | `/seat-booking/settings/rooms` | `@storeRoom` | [G] | `seat-booking.settings.rooms.store` | redirect | Server Action |
| PATCH | `/seat-booking/settings/rooms/{id}` | `@updateRoom` | [G] | `seat-booking.settings.rooms.update` | redirect | Server Action |
| DELETE | `/seat-booking/settings/rooms/{id}` | `@deleteRoom` | [G] | `seat-booking.settings.rooms.delete` | redirect | Server Action |
| POST | `/seat-booking/settings/seats` | `@storeSeat` | [G] | `seat-booking.settings.seats.store` | redirect | Server Action |
| PATCH | `/seat-booking/settings/seats/{id}` | `@updateSeat` | [G] | `seat-booking.settings.seats.update` | redirect | Server Action |
| DELETE | `/seat-booking/settings/seats/{id}` | `@deleteSeat` | [G] | `seat-booking.settings.seats.delete` | redirect | Server Action |
| PUT | `/seat-booking/{id}` | `@updateBooking` | [G] | `seat-booking.update` | redirect | `app/api/seat-booking/[id]/route.ts` |
| DELETE | `/seat-booking/{id}` | `@cancelById` | [G] | `seat-booking.cancel` | redirect | same route file |

## 1.7 Admin group (`Route::middleware('admin')`, `web.php:210-260`)

| Method | URI | Controller@action | MW | Name | View | → Next.js |
|---|---|---|---|---|---|---|
| GET | `/admin` | `AdminController@index` | [G+A] | `admin.index` | `admin.index` (`:46`) | `app/(portal)/admin/page.tsx` |
| GET | `/admin/users` | `@users` | [G+A] | `admin.users` | `admin.users` (`:59`) | `app/(portal)/admin/users/page.tsx` |
| GET | `/admin/users/{id}/view` | `@viewUser` | [G+A] | `admin.users.view` | **`profile.show`** (`:112`) — reuses the profile view | `app/(portal)/admin/users/[id]/page.tsx` |
| GET | `/admin/users/{id}/edit` | `@editUser` | [G+A] | `admin.users.edit` | `admin.edit-user` (`:129`) | `app/(portal)/admin/users/[id]/edit/page.tsx` |
| PATCH | `/admin/users/{id}/update` | `@updateUser` | [G+A] | `admin.users.update` | redirect | Server Action |
| POST | `/admin/users/{id}/reset-password` | `@resetPassword` | [G+A] | `admin.users.reset-password` | redirect | Server Action |
| PATCH | `/admin/users/{id}/activate` | `@activate` | [G+A] | `admin.users.activate` | redirect | Server Action |
| PATCH | `/admin/users/{id}/role` | `@updateRole` | [G+A] | `admin.users.role` | redirect | Server Action |
| PATCH | `/admin/users/{id}/deactivate` | `@deactivate` | [G+A] | `admin.users.deactivate` | redirect | Server Action |
| DELETE | `/admin/users/{id}` | `@deleteUser` | [G+A] | `admin.users.delete` | redirect | Server Action |
| GET | `/admin/register` | `@showRegister` | [G+A] | `admin.register` | `admin.register` (`:209`) | `app/(portal)/admin/register/page.tsx` |
| POST | `/admin/register` | `@register` | [G+A] | `admin.register.post` | redirect | Server Action |
| GET | `/admin/groups` | `GroupController@index` | [G+A] | `admin.groups` | `admin.groups` (`GroupController.php:30`) | `app/(portal)/admin/groups/page.tsx` |
| POST | `/admin/groups` | `@store` | [G+A] | `admin.groups.store` | redirect | Server Action |
| PATCH | `/admin/groups/{id}` | `@update` | [G+A] | `admin.groups.update` | redirect | Server Action |
| DELETE | `/admin/groups/{id}` | `@destroy` | [G+A] | `admin.groups.delete` | redirect | Server Action |
| POST | `/admin/groups/{id}/members` | `@addMembers` | [G+A] | `admin.groups.members.add` | redirect | Server Action |
| DELETE | `/admin/groups/{id}/members/{userId}` | `@removeMember` | [G+A] | `admin.groups.members.remove` | redirect | Server Action |
| GET | `/admin/documents` | `AdminController@documents` | [G+A] | `admin.documents` | `admin.documents` (`:298`) | `app/(portal)/admin/documents/page.tsx` |
| GET | `/admin/documents/report-data` | `@policyReport` | [G+A] | `admin.documents.report-data` | JSON | `app/api/admin/documents/report-data/route.ts` |
| GET | `/admin/documents/report-data/pdf` | `@exportPolicyReportPdf` | [G+A] | `admin.documents.report-data.pdf` | `admin.policy-report-pdf` (`:559`) | `app/api/admin/documents/report-data/pdf/route.ts` |
| GET | `/admin/documents/bulk-assign` | `@bulkAssignPage` | [G+A] | `admin.documents.bulk-assign` | `admin.bulk-assign` (`:645`) | `app/(portal)/admin/documents/bulk-assign/page.tsx` |
| POST | `/admin/documents/upload-with-assignments` | `@uploadWithAssignments` | [G+A] | `admin.documents.upload-with-assignments` | JSON/redirect | `app/api/admin/documents/upload-with-assignments/route.ts` |
| POST | `/admin/documents/notify-batch` | `@notifyDocumentBatch` | [G+A] | `admin.documents.notify-batch` | JSON | `app/api/admin/documents/notify-batch/route.ts` |
| GET | `/admin/documents/{id}/views` | `@documentViews` | [G+A] | `admin.documents.views` | `admin.document-views` (`:650`) | `app/(portal)/admin/documents/[id]/views/page.tsx` |
| GET | `/admin/documents/{id}/views/export-csv` | `@exportDocumentViewsCsv` | [G+A] | `admin.documents.views.export-csv` | CSV download | `app/api/admin/documents/[id]/views/export-csv/route.ts` |
| GET | `/admin/documents/{id}/views/export-pdf` | `@exportDocumentViewsPdf` | [G+A] | `admin.documents.views.export-pdf` | `admin.document-views-pdf` (`:808`) | `app/api/admin/documents/[id]/views/export-pdf/route.ts` |
| POST | `/admin/documents` | `@storeDocument` | [G+A] | `admin.documents.store` | redirect | Server Action |
| PATCH | `/admin/documents/{id}` | `@updateDocument` | [G+A] | `admin.documents.update` | redirect | Server Action |
| GET | `/admin/documents/{id}/assignments-data` | `@documentAssignmentsData` | [G+A] | `admin.documents.assignments-data` | JSON | `app/api/admin/documents/[id]/assignments-data/route.ts` |
| DELETE | `/admin/documents/{id}` | `@deleteDocument` | [G+A] | `admin.documents.delete` | redirect | Server Action |
| POST | `/admin/documents/{id}/delete` | `@deleteDocument` | [G+A] | `admin.documents.delete.ajax` | JSON | **duplicate handler** — POST alias for browsers/fetch that can't DELETE |
| GET | `/admin/org-chart` | `@orgChart` | [G+A] | `admin.org-chart` | `admin.org-chart` (`:991`) | `app/(portal)/admin/org-chart/page.tsx` |
| PATCH | `/admin/users/{id}/manager` | `@updateManager` | [G+A] | `admin.users.manager` | JSON/redirect | Server Action |
| POST | `/admin/sync-photos` | `@syncPhotos` | [G+A] | `admin.sync-photos` | redirect | Server Action |
| GET | `/chat/team-access` | `ChatController@teamAccess` | [G+A] | `chat.team-access` | `chat.team-access` (`ChatController.php:120`) | `app/(portal)/chat/team-access/page.tsx` |
| POST | `/chat/team-access/group-mappings` | `@storeGroupMapping` | [G+A] | `chat.team-access.group-mappings.store` | redirect | Server Action |
| PATCH | `/chat/team-access/group-mappings/{id}` | `@updateGroupMapping` | [G+A] | `chat.team-access.group-mappings.update` | redirect | Server Action |
| DELETE | `/chat/team-access/group-mappings/{id}` | `@deleteGroupMapping` | [G+A] | `chat.team-access.group-mappings.delete` | redirect | Server Action |
| POST | `/chat/team-access/group-mappings/{id}/members` | `@addTeamMember` | [G+A] | `chat.team-access.group-mappings.members.add` | redirect | Server Action |
| DELETE | `/chat/team-access/group-mappings/{id}/members/{userId}` | `@removeTeamMember` | [G+A] | `chat.team-access.group-mappings.members.remove` | redirect | Server Action |
| PUT | `/chat/team-access/overrides/{userId}` | `@putOverride` | [G+A] | `chat.team-access.overrides.update` | redirect | Server Action |
| DELETE | `/chat/team-access/overrides/{userId}` | `@deleteOverride` | [G+A] | `chat.team-access.overrides.delete` | redirect | Server Action |

## 1.8 Document viewing + API proxies (auth'd, NOT admin-gated)

Declared **outside** the admin group at `web.php:261-268`, so any authenticated non-Guest user can call them.

| Method | URI | Controller@action | MW | Name | View | → Next.js |
|---|---|---|---|---|---|---|
| GET | `/documents/{id}/view` | `AdminController@viewDocument` | [G] | `documents.view` | `admin.document-view` (`:578`) | `app/(portal)/documents/[id]/view/page.tsx` |
| GET | `/api-proxy/documents` | `AdminController@proxyDocumentList` | [G] | *(unnamed)* | JSON | `app/api/proxy/documents/route.ts` |
| GET | `/api-proxy/documents/{id}` | `@proxyGetDocument` | [G] | *(unnamed)* | JSON | `app/api/proxy/documents/[id]/route.ts` |
| POST | `/api-proxy/documents/{id}/view` | `@proxyRecordView` | [G] | *(unnamed)* | JSON | `.../[id]/view/route.ts` |
| POST | `/api-proxy/documents/{id}/read-fully` | `@proxyRecordReadFully` | [G] | *(unnamed)* | JSON | `.../[id]/read-fully/route.ts` |
| POST | `/api-proxy/assignments/bulk` | `@proxyBulkAssign` | [G] | *(unnamed)* | JSON | `app/api/proxy/assignments/bulk/route.ts` |
| GET | `/api-proxy/assignments/pending` | `@proxyPendingDocuments` | [G] | *(unnamed)* | JSON | `app/api/proxy/assignments/pending/route.ts` |
| GET | `/api-proxy/notifications/unread` | `NotificationController@unread` | [G] | *(unnamed)* | JSON | `app/api/proxy/notifications/unread/route.ts` |
| POST | `/api-proxy/notifications/read-all` | `@readAll` | [G] | *(unnamed)* | JSON | `app/api/proxy/notifications/read-all/route.ts` |
| POST | `/api-proxy/notifications/{id}/read` | `@markRead` | [G] | *(unnamed)* | JSON | `app/api/proxy/notifications/[id]/read/route.ts` |

> **Why the `/api-proxy/*` layer exists at all** — `layouts/app.blade.php:728-730`: *"Routed through Laravel's same-origin proxy (not the Spring Boot origin directly) — production's CSP is `connect-src 'self'`, which silently blocks any cross-origin fetch() to the backend host."* The Next.js rewrite needs the same same-origin proxy layer (Route Handlers) or an equally deliberate CSP change.

## 1.9 Interview (admin-gated group, `web.php:277-287`)

`web.php:272-276` documents this as a **soft-launch gate**: the whole module is Admin-only *for now*; to open it up, remove the `Route::middleware('admin')` wrapper and update the home tile.

| Method | URI | Controller@action | MW | Name | View | → Next.js |
|---|---|---|---|---|---|---|
| GET | `/interview` | `InterviewController@index` | [G+A] | `interview.index` | `interview.dashboard` (`:31`) | `app/(portal)/interview/page.tsx` |
| GET | `/interview/recruiter` | `@recruiterDashboard` | [G+A] | `interview.recruiter` | `interview.recruiter-dashboard` (`:48`) | `app/(portal)/interview/recruiter/page.tsx` |
| GET | `/interview/recruiter/question-sets/{id}` | `@recruiterQuestionSetDetails` | [G+A] | `interview.recruiter.question-set.details` | JSON | `app/api/interview/recruiter/question-sets/[id]/route.ts` |
| POST | `/interview/recruiter/upload-questions` | `@recruiterUploadQuestions` | [G+A] | `interview.recruiter.upload-questions` | redirect/JSON | `app/api/interview/recruiter/upload-questions/route.ts` |
| DELETE | `/interview/recruiter/question-sets/{id}` | `@recruiterDeleteQuestionSet` | [G+A] | `interview.recruiter.question-set.delete` | JSON | same as details route file |
| GET | `/interview/create-test` | `@createTest` | [G+A] | `interview.create-test` | `interview.create-test` (`:146`) | `app/(portal)/interview/create-test/page.tsx` |
| POST | `/interview/create-test` | `@storeTest` | [G+A] | `interview.create-test.store` | redirect | Server Action |
| GET | `/interview/test-details/{id}` | `@testDetails` | [G+A] | `interview.test-details` | `interview.test-details` (`:200`) | `app/(portal)/interview/test-details/[id]/page.tsx` |
| POST | `/interview/close-test/{id}` | `@closeTest` | [G+A] | `interview.close-test` | redirect | Server Action |

## 1.10 Profile

| Method | URI | Controller@action | MW | Name | View | → Next.js |
|---|---|---|---|---|---|---|
| GET | `/profile` | `ProfileController@show` | [G] | `profile.show` | `profile.show` (`ProfileController.php:13`) | `app/(portal)/profile/page.tsx` |
| PATCH | `/profile` | `@update` | [G] | `profile.update` | redirect | Server Action |
| PATCH | `/profile/theme` | `@updateTheme` | [G] | `profile.theme.update` | **JSON** `{ok:true}` / 422 | `app/api/profile/theme/route.ts` |
| POST | `/profile/password` | `@changePassword` | [G] | `profile.password` | redirect | Server Action |
| POST | `/profile/daily-report` | `@saveDailyReport` | [G] | `profile.daily-report.save` | JSON/redirect | Server Action |
| GET | `/profile/daily-reports` | `@getDailyReports` | [G] | `profile.daily-reports` | JSON | `app/api/profile/daily-reports/route.ts` |

## 1.11 AI Chat / Knowledge Base (`['admin','ai-chat.access']`, `web.php:309-314`)

`web.php:304-308` documents the **double gate**: Admin-only soft launch **plus** the server-computed `aiChatEnabled` flag.

| Method | URI | Controller@action | MW | Name | View | → Next.js |
|---|---|---|---|---|---|---|
| GET | `/chat` | `ChatController@index` | [G] + `admin` + `ai-chat.access` | `chat.index` | `chat.index` (`:31`) | `app/(portal)/chat/page.tsx` |
| GET | `/chat/models` | `@models` | same | `chat.models` | JSON | `app/api/chat/models/route.ts` |
| POST | `/chat/send` | `@send` | same | `chat.send` | JSON | `app/api/chat/send/route.ts` |
| GET | `/chat/profile` | `@profile` | same | `chat.profile` | `chat.profile` (`:86`) | `app/(portal)/chat/profile/page.tsx` |

## 1.12 Password Manager (admin-gated group, `web.php:320-384`)

`web.php:316-319` documents this as a soft-launch Admin-only gate, same shape as Interview.

| Method | URI | Controller@action | MW | Name | View | → Next.js |
|---|---|---|---|---|---|---|
| GET | `/password-manager` | `PasswordManagerController@dashboard` | [G+A] | `password-manager.dashboard` | `password-manager.dashboard` (`:400`) | `app/(portal)/password-manager/page.tsx` |
| GET | `/password-manager/vault` | `@index` | [G+A] | `password-manager.index` | `password-manager.index` via `vaultView(scope:'mine')` (`:235`) | `app/(portal)/password-manager/vault/page.tsx` |
| GET | `/password-manager/vault/keys` | `@vaultKeys` | [G+A] | `password-manager.vault.keys` | JSON (crypto blobs) | `app/api/password-manager/vault/keys/route.ts` |
| POST | `/password-manager/vault/setup` | `@vaultSetup` | [G+A] | `password-manager.vault.setup` | JSON | `.../vault/setup/route.ts` |
| GET | `/password-manager/vault/recovery-params` | `@vaultRecoveryParams` | [G+A] | `password-manager.vault.recovery-params` | JSON (crypto blobs) | `.../vault/recovery-params/route.ts` |
| POST | `/password-manager/vault/recover` | `@vaultRecover` | [G+A] | `password-manager.vault.recover` | JSON | `.../vault/recover/route.ts` |
| GET | `/password-manager/vault/public-keys` | `@vaultPublicKeys` | [G+A] | `password-manager.vault.public-keys` | JSON | `.../vault/public-keys/route.ts` |
| GET | `/password-manager/vault/security` | `@vaultSecurityPage` | [G+A] | `password-manager.vault.security` | `password-manager.vault-security` (`:108`) | `app/(portal)/password-manager/vault/security/page.tsx` |
| GET | `/password-manager/vault/mfa/status` | `@vaultMfaStatus` | [G+A] | `password-manager.vault.mfa.status` | JSON | `.../vault/mfa/status/route.ts` |
| POST | `/password-manager/vault/mfa/setup` | `@vaultMfaSetup` | [G+A] | `password-manager.vault.mfa.setup` | JSON | `.../vault/mfa/setup/route.ts` |
| POST | `/password-manager/vault/mfa/confirm` | `@vaultMfaConfirm` | [G+A] | `password-manager.vault.mfa.confirm` | JSON | `.../vault/mfa/confirm/route.ts` |
| POST | `/password-manager/vault/mfa/verify` | `@vaultMfaVerify` | [G+A] | `password-manager.vault.mfa.verify` | JSON | `.../vault/mfa/verify/route.ts` |
| POST | `/password-manager/vault/mfa/disable` | `@vaultMfaDisable` | [G+A] | `password-manager.vault.mfa.disable` | JSON | `.../vault/mfa/disable/route.ts` |
| GET | `/password-manager/vault-groups/page` | `@vaultGroupsPage` | [G+A] | `password-manager.vault-groups.page` | `password-manager.vault-groups` (`:127`) | `app/(portal)/password-manager/vault-groups/page.tsx` |
| GET | `/password-manager/vault-groups` | `@vaultGroups` | [G+A] | `password-manager.vault-groups.index` | JSON | `app/api/password-manager/vault-groups/route.ts` |
| POST | `/password-manager/vault-groups` | `@storeVaultGroup` | [G+A] | `password-manager.vault-groups.store` | JSON | same route file |
| GET | `/password-manager/vault-groups/{id}/members` | `@vaultGroupMembers` | [G+A] | `password-manager.vault-groups.members` | JSON | `.../vault-groups/[id]/members/route.ts` |
| GET | `/password-manager/vault-groups/{id}/my-key` | `@vaultGroupMyKey` | [G+A] | `password-manager.vault-groups.my-key` | JSON (wrapped GK) | `.../vault-groups/[id]/my-key/route.ts` |
| POST | `/password-manager/vault-groups/{id}/members` | `@addVaultGroupMember` | [G+A] | `password-manager.vault-groups.members.add` | JSON | same as members route file |
| DELETE | `/password-manager/vault-groups/{id}/members/{userId}` | `@removeVaultGroupMember` | [G+A] | `password-manager.vault-groups.members.remove` | JSON | `.../members/[userId]/route.ts` |
| DELETE | `/password-manager/vault-groups/{id}` | `@destroyVaultGroup` | [G+A] | `password-manager.vault-groups.destroy` | JSON | `.../vault-groups/[id]/route.ts` |
| GET | `/password-manager/vault-group-access` | `@vaultGroupAccessPage` | [G+A] | `password-manager.vault-group-access.page` | `password-manager.vault-group-access` (`:209`) | `app/(portal)/password-manager/vault-group-access/page.tsx` |
| PATCH | `/password-manager/vault-group-access/{id}` | `@toggleVaultGroupAccess` | [G+A] | `password-manager.vault-group-access.toggle` | JSON | `.../vault-group-access/[id]/route.ts` |
| GET | `/password-manager/logins` | `@logins` | [G+A] | `password-manager.logins` | `password-manager.logins` via `vaultView(category:'LOGIN')` (`:241`) | `app/(portal)/password-manager/logins/page.tsx` |
| GET | `/password-manager/favorites` | `@favorites` | [G+A] | `password-manager.favorites` | `password-manager.favorites` via `vaultView(favorite:'true')` (`:246`) | `app/(portal)/password-manager/favorites/page.tsx` |
| GET | `/password-manager/archive` | `@archive` | [G+A] | `password-manager.archive` | `password-manager.archive` via `vaultView(archived:'true')` (`:251`) | `app/(portal)/password-manager/archive/page.tsx` |
| GET | `/password-manager/bin` | `@bin` | [G+A] | `password-manager.bin` | `password-manager.bin` via `vaultView(bin:'true')` (`:256`) | `app/(portal)/password-manager/bin/page.tsx` |
| GET | `/password-manager/key-management` | `@keyManagement` | [G+A] | `password-manager.key-management` | `password-manager.key-management` via `vaultView(category:'SSH_KEY')` (`:262`) | `app/(portal)/password-manager/key-management/page.tsx` |
| GET | `/password-manager/generator` | `@generator` | [G+A] | `password-manager.generator` | `password-manager.generator` (`:269`) | `app/(portal)/password-manager/generator/page.tsx` |
| POST | `/password-manager` | `@store` | [G+A] | `password-manager.store` | JSON/redirect | Server Action / Route Handler |
| GET | `/password-manager/folders` | `@folders` | [G+A] | `password-manager.folders` | JSON | `app/api/password-manager/folders/route.ts` |
| POST | `/password-manager/folders` | `@storeFolder` | [G+A] | `password-manager.folders.store` | JSON | same route file |
| DELETE | `/password-manager/folders/{id}` | `@destroyFolder` | [G+A] | `password-manager.folders.destroy` | JSON | `.../folders/[id]/route.ts` |
| GET | `/password-manager/share` | `@shareForm` | [G+A] | `password-manager.share.form` | JSON/partial | `app/api/password-manager/share/route.ts` |
| POST | `/password-manager/share` | `@share` | [G+A] | `password-manager.share.store` | JSON | same route file |
| GET | `/password-manager/{entryId}/shares` | `@sharesFor` | [G+A] | `password-manager.shares.for` | JSON | `.../[entryId]/shares/route.ts` |
| DELETE | `/password-manager/{entryId}/shares/{userId}` | `@unshare` | [G+A] | `password-manager.share.destroy` | JSON | `.../shares/[userId]/route.ts` |
| POST | `/password-manager/policies/{id}/apply` | `@applyPolicy` | [G+A] | `password-manager.policies.apply` | JSON | `.../policies/[id]/apply/route.ts` |
| GET | `/password-manager/policies/{id}/document-file` | `@policyDocumentFile` | [G+A] | `password-manager.policies.document-file` | file stream | `.../policies/[id]/document-file/route.ts` |
| PATCH | `/password-manager/{id}` | `@update` | [G+A] | `password-manager.update` | JSON | `app/api/password-manager/[id]/route.ts` |
| DELETE | `/password-manager/{id}` | `@destroy` | [G+A] | `password-manager.destroy` | JSON | same route file |
| POST | `/password-manager/{id}/restore` | `@restore` | [G+A] | `password-manager.restore` | JSON | `.../[id]/restore/route.ts` |
| DELETE | `/password-manager/{id}/purge` | `@purge` | [G+A] | `password-manager.purge` | JSON | `.../[id]/purge/route.ts` |
| POST | `/password-manager/{id}/archive` | `@archiveItem` | [G+A] | `password-manager.archive-item` | JSON | `.../[id]/archive/route.ts` |
| POST | `/password-manager/{id}/unarchive` | `@unarchive` | [G+A] | `password-manager.unarchive` | JSON | `.../[id]/unarchive/route.ts` |
| POST | `/password-manager/{id}/favorite` | `@toggleFavorite` | [G+A] | `password-manager.favorite` | JSON | `.../[id]/favorite/route.ts` |
| GET | `/password-manager/{id}/reveal` | `@reveal` | [G+A] | `password-manager.reveal` | **JSON (crypto blobs)** | `.../[id]/reveal/route.ts` |
| GET | `/password-manager/{id}/history` | `@history` | [G+A] | `password-manager.history` | JSON | `.../[id]/history/route.ts` |
| POST | `/password-manager/{id}/history/{historyId}/restore` | `@restoreHistory` | [G+A] | `password-manager.history.restore` | JSON | `.../history/[historyId]/restore/route.ts` |
| GET | `/password-manager/audit-log` | `@auditLog` | [G+A] | `password-manager.audit-log` | `password-manager.audit-log` (`:623`) | `app/(portal)/password-manager/audit-log/page.tsx` |
| GET | `/password-manager/send` | `@shareLinkPage` | [G+A] | `password-manager.send.page` | `password-manager.send` (`:649`) | `app/(portal)/password-manager/send/page.tsx` |
| POST | `/password-manager/send` | `@shareLinkCreate` | [G+A] | `password-manager.send.store` | JSON | `app/api/password-manager/send/route.ts` |
| DELETE | `/password-manager/send/{id}` | `@shareLinkRevoke` | [G+A] | `password-manager.send.destroy` | JSON | `.../send/[id]/route.ts` |
| GET | `/password-manager/share-link/{id}` | `@shareLinkView` | [G+A] | `password-manager.share-link.view` | `password-manager.share-link-view` (`:685`) | `app/(portal)/password-manager/share-link/[id]/page.tsx` |
| GET | `/password-manager/share-link/{id}/meta` | `@shareLinkMeta` | [G+A] | `password-manager.share-link.meta` | JSON | `.../share-link/[id]/meta/route.ts` |
| POST | `/password-manager/share-link/{id}/open` | `@shareLinkOpen` | [G+A] | `password-manager.share-link.open` | JSON (crypto blobs) | `.../share-link/[id]/open/route.ts` |
| GET | `/password-manager/policies` | `@policies` | [G+A] | `password-manager.policies` | `password-manager.policies` (`:279`) | `app/(portal)/password-manager/policies/page.tsx` |
| POST | `/password-manager/policies` | `@storePolicy` | [G+A] | `password-manager.policies.store` | JSON | `app/api/password-manager/policies/route.ts` |
| PATCH | `/password-manager/policies/{id}` | `@updatePolicy` | [G+A] | `password-manager.policies.update` | JSON | `.../policies/[id]/route.ts` |
| DELETE | `/password-manager/policies/{id}` | `@destroyPolicy` | [G+A] | `password-manager.policies.destroy` | JSON | same route file |

**Route count: 199 declared routes + `/up`.**

### Route-inventory notes for the rewrite

- **`/password-manager/vault-groups/page`** and **`/password-manager/vault-group-access`** use a literal `/page` segment to dodge the `{id}` wildcard. In Next.js the wildcard/static conflict does not exist — but **keeping the URL** matters for bookmarks/emails. Decide explicitly.
- **`/password-manager/share-link/{id}` is inside the admin group.** A "Send" link mailed to a non-admin recipient will 403. That is either a live bug or an intentional soft-launch consequence (`web.php:316-319`).
- **`/tickets/mine`** (URI) → route name `tickets.my-created` → view `tickets.my-created`. The URI, route name and view name all differ. Same for `/hour-tracking/projects` → `hour-tracking.dashboard.projects`.
- **Two views are dead code** (no route, no `view()` call anywhere in `app/` or `routes/`): `admin/documents-status.blade.php` (336 lines) and `admin/notifications.blade.php` (337 lines). Do not port them.

---

# 2. Middleware

Seven middleware classes exist in `app/Http/Middleware/`. Four are aliased and route-applied; three run globally on the `web` group.

## 2.1 `JwtAuth` — alias `auth.jwt` (`app/Http/Middleware/JwtAuth.php`)

**Real authentication gate at the frontend layer, but explicitly NOT a token validator.** Class docblock (`:16-18`): *"JWT signature/expiry validation is handled entirely by the Spring Boot backend on every API request."*

What it checks, in order:

1. **`session('auth_user')` must exist** (`:29-34`). If absent → `rememberIntendedUrl()` then `redirect()->route('login')`. **Failure mode: 302 to `/login`.**
2. **Role normalization** (`:37`, impl `:155-169`) — mutates the session: `['Admin','admin','ADMIN'] → 'Admin'`, `['Guest','guest','GUEST'] → 'Guest'`. Everything else is left untouched (so `'User'`, `'user'`, and any custom role string pass through raw).
3. **Token freshness + silent refresh** (`:40-66`):
   ```php
   if ($this->isTokenExpiredOrExpiringSoon(session('jwt_token'))) {
       $refreshToken = session('refresh_token');
       if ($refreshToken) { $refreshed = $this->refreshAccessToken($refreshToken); ... }
   ```
   `isTokenExpiredOrExpiringSoon` (`:176-194`) base64url-decodes the JWT payload **without verifying the signature** and treats the token as expired if `exp < time() + 60`:
   ```php
   $payload = json_decode(base64_decode(strtr($parts[1], '-_', '+/')), true);
   ...
   return $payload['exp'] < (time() + 60);
   ```
   Refresh calls `POST {API_BASE_URL}/api/auth/refresh` with `{refreshToken}`, 5s timeout (`:200-223`). On failure it forgets `jwt_token`, `refresh_token`, `auth_user` and redirects to login with `withErrors(['auth' => 'Your session has expired. Please log in again.'])`.
4. **Avatar/name self-heal**, at most every 5 minutes (`:75`, impl `:119-149`): `GET {API_BASE_URL}/api/users/{id}/profile` with `->withToken($token)`, 5s timeout, merges `avatarUrl` and `name` into `session('auth_user')`, stamps `auth_user_synced_at`. Wrapped in try/catch — *"avatar staleness is never worth failing a request over"* (`:145-146`).
5. **View sharing** (`:78-81`): `view()->share('authUser', session('auth_user'))` and `view()->share('jwtToken', session('jwt_token'))`.

`rememberIntendedUrl()` (`:107-112`) — three deliberate exclusions, each documented at `:96-105`:
```php
if ($request->isMethod('get') && !$request->expectsJson() && $request->path() !== '/') {
    session(['url.intended' => $request->fullUrl()]);
}
```
GET only, never for `Accept: application/json` (so the 15s notification poll can't hijack the post-login destination), and **never for `/`** (so a plain visit to the bare domain doesn't skip the `/home` launcher).

**Classification: real authorization at the frontend layer for page access, but a UX gate with respect to the JWT itself** — no signature verification happens here; the backend is the enforcement point.

## 2.2 `AdminOnly` — alias `admin` (`app/Http/Middleware/AdminOnly.php`)

```php
$role = session('auth_user.role') ?? (session('auth_user')['role'] ?? '');
if ($role !== 'Admin') {
    abort(403, 'You do not have permission to access this page.');
}
```
Exact-string comparison against the **already-normalized** session role. **Failure mode: HTTP 403 (Laravel error page), not a redirect.**

Docblock (`:11-14`) is explicit that this is a frontend-layer gate added because *"the Laravel frontend previously let any authenticated user reach admin pages... as long as they were logged in via auth.jwt"* and that *"The Spring Boot backend enforces its own authorization on the underlying API calls."*

**Classification: UX gate + defense in depth. Not the authorization boundary.** Notably, `/admin/settings/*` (§1.5) is *not* covered by it.

## 2.3 `GuestAccess` — alias `guest.access` (`app/Http/Middleware/GuestAccess.php`)

Non-Guest roles pass straight through (`:21-23`). A Guest may reach **only** this allowlist (`:26-35`):
`home`, `seat-booking.index`, `seat-booking.map`, `seat-booking.room-map`, `seat-booking.book-seats`, `seat-booking.book-room`, `seat-booking.cancel`, `seat-booking.cancel-code`, `seat-booking.update`, `seat-booking.api.*`.

Anything else → `redirect()->route('seat-booking.index')`. **Failure mode: 302, silently.** Note `seat-booking.report`, `seat-booking.report.*` and `seat-booking.settings.*` are deliberately *not* in the list.

**Classification: UX gate (route-name allowlist). Silent redirect, no error surfaced.**

## 2.4 `AiChatAccess` — alias `ai-chat.access` (`app/Http/Middleware/AiChatAccess.php`)

```php
if (session('auth_user.aiChatEnabled')) { return $next($request); }
return redirect()->route('home')->withErrors(['error' => 'AI Chat isn\'t available for your account yet.']);
```
Reads a boolean the backend computed at login from the AD-group→Team mapping plus any per-person override (docblock `:9-14`, points at `AuthService`/`LiteLlmService`). Docblock states plainly: *"This is a frontend-layer convenience redirect only — the backend's ChatController/LiteLlmService independently reject provisioning for a user with no resolvable Team, so this middleware isn't the sole enforcement point."*

**Classification: UX gate, self-declared.**

## 2.5 `SecurityHeaders` — global (`app/Http/Middleware/SecurityHeaders.php`)

**Two CSP policies, split on `$request->is('password-manager*')` (`:37`).**

Vault paths get a per-request nonce (`:41-44`), shared into views as `$cspNonce`:
```php
$nonce = base64_encode(Str::random(24));
$request->attributes->set('csp_nonce', $nonce);
view()->share('cspNonce', $nonce);
```
Vault CSP (`:51-69`) — note `'wasm-unsafe-eval'`, required by hash-wasm's Argon2id (comment `:54-56`):
```
default-src 'self'
script-src 'self' 'nonce-{$nonce}' 'wasm-unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com
script-src-elem 'self' 'nonce-{$nonce}' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com
script-src-attr 'unsafe-inline'
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
img-src 'self' data: blob:
font-src 'self' data: https://fonts.gstatic.com
connect-src 'self' {$apiOrigin}     // $apiOrigin = rtrim(env('API_BASE_URL', "'self'"), '/')  (:49)
frame-src 'none'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
```
Baseline CSP for everything else (`:75-86`) — looser, keeps `'unsafe-inline' 'unsafe-eval'` for scripts and `connect-src 'self'` with no backend origin:
```
default-src 'self'
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://cdnjs.cloudflare.com
style-src 'self' 'unsafe-inline' https://fonts.googleapis.com
img-src 'self' data: blob:; font-src 'self' data: https://fonts.gstatic.com
connect-src 'self'; frame-src 'self' data: blob:; frame-ancestors 'self'
object-src 'none'; base-uri 'self'
```
Always set (`:89-93`): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Strict-Transport-Security: max-age=31536000; includeSubDomains`, `X-Permitted-Cross-Domain-Policies: none`.

Docblock (`:10-13`) states this middleware — not `docker/nginx.conf` — is now the single source of truth, and (`:20-26`) that `script-src-attr 'unsafe-inline'` is a knowing concession because the vault views still use `onclick=`/`onchange=` attributes.

**Classification: real security control. Must be reproduced in the Next.js rewrite (`next.config.js` headers or middleware).**

## 2.6 `PreventBackHistoryCache` — global (`app/Http/Middleware/PreventBackHistoryCache.php`)

```php
$response->headers->set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0, private');
$response->headers->set('Pragma', 'no-cache');
$response->headers->set('Expires', '0');
```
Docblock (`:9-20`): `no-store` is the specific directive that excludes a page from bfcache in every modern browser; applied to **every** page including `/login`, so Back after logout can never render an authenticated page from cache without re-hitting `JwtAuth`.

**Classification: real security control.** This is a genuine, easy-to-lose behaviour in a client-rendered SPA — see §11.

## 2.7 `StripDisallowedGlyphs` — global (`app/Http/Middleware/StripDisallowedGlyphs.php`)

```php
$request->merge(GlyphFilter::clean($request->input()));
```
Only touches `input()`; uploaded files/binary/base64 payloads are untouched (docblock `:12-13`).

Its counterpart on the **response** side is registered in `app/Providers/AppServiceProvider.php:30-37` — a Guzzle global response middleware that runs `GlyphFilter::clean()` over the **raw body of every Spring Boot response** before any controller or view sees it:
```php
Http::globalResponseMiddleware(function (ResponseInterface $response) {
    $body = (string) $response->getBody();
    $cleaned = GlyphFilter::clean($body);
    return $cleaned === $body ? $response : $response->withBody(Utils::streamFor($cleaned));
});
```
`app/Support/GlyphFilter.php:15-18` — the exact disallowed set, stripped (not replaced):
```php
private const DISALLOWED = [
    'æ', 'Æ', 'œ', 'Œ', 'ß', 'ø', 'Ø', 'å', 'Å', 'ç', 'Ç',
    'ñ', 'Ñ', 'ð', 'Ð', 'þ', 'Þ', 'ł', 'Ł', 'đ', 'Đ',
];
```
**Classification: product rule, bidirectional. Nothing in the browser enforces it — it is purely server-side, so a client-only React port loses it entirely.** High parity risk (§11).

## 2.8 Exception handling (`bootstrap/app.php:29-37`)

```php
$exceptions->render(function (TokenMismatchException $e, $request) {
    return redirect()->route('login')->with('error', 'Your session expired. Please log in again.');
});
```
A stale CSRF token becomes a friendly redirect instead of Laravel's bare 419 page — comment notes this is most visible on Logout.

## 2.9 Summary table

| Middleware | Scope | Checks | Failure mode | Real authz or UX gate? |
|---|---|---|---|---|
| `JwtAuth` | `auth.jwt` alias, wraps all protected routes | `session('auth_user')` present; refreshes JWT if `exp < now+60`; syncs avatar every 5 min | 302 `/login` (+ stashes intended URL) | Real gate on page access; **no JWT signature validation** |
| `AdminOnly` | `admin` alias | `session('auth_user.role') === 'Admin'` | `abort(403)` | UX gate + defense in depth (self-declared) |
| `GuestAccess` | `guest.access` alias, in the same group as `auth.jwt` | route-name allowlist for `role === 'Guest'` | 302 `seat-booking.index`, silent | UX gate |
| `AiChatAccess` | `ai-chat.access` alias | `session('auth_user.aiChatEnabled')` truthy | 302 `home` + error bag | UX gate (self-declared) |
| `SecurityHeaders` | global `web` | n/a — sets CSP + 5 hardening headers; nonce for `password-manager*` | n/a | **Real security control** |
| `PreventBackHistoryCache` | global `web` | n/a — sets `no-store` etc. | n/a | **Real security control** |
| `StripDisallowedGlyphs` | global `web` | strips 21 glyphs from all request input | n/a (silent mutation) | **Product rule** (paired with the response-side filter in `AppServiceProvider`) |
