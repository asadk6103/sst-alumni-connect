# Development progress — SST Alumni Connect

Last updated: 2026-11-24 · Current stage: **3 — Engagement (in progress)** · Stage 2 complete

## Stage plan

| Stage | Scope | Status |
|---|---|---|
| 1 Foundation | architecture, repository, Docker Compose, database, authentication, RBAC, setup wizard, branding, configuration center core | ✅ built & tested locally |
| 2 Alumni core | registration (alumni fields, institutional record matching), verification, profiles, batches, directory, alumni dashboard | ✅ built & tested locally |
| 3 Engagement | community feed (real-time), messaging, groups, events + QR check-in, jobs, mentorship, achievements | 🚧 in progress |
| 4 Institutional | donations (gateway-less until providers are chosen), scholarships, newsletters, notifications, gallery | ⏳ |
| 5 Administration | CMS + drag-and-drop page builder, navigation builder, custom fields, localisation (Urdu/RTL), reports & exports | ⏳ |
| 6 Production readiness | security testing, load tests at target scale, HTTPS overlay, handbooks, ERD, checklist | ⏳ |

Decisions: FastAPI backend (architectural revision), Next.js for public pages + React/Vite for portal/admin,
payments on hold, generic HTTP SMS provider, students both self-register and are imported, p95 latency
budget 200 ms for API reads.

## Completed (Stage 2 — Alumni core)

**Registration** — public three-step form (account → SST details → today) for alumni and current students with
every field of the spec (name, email, mobile, gender, date of birth, admission / graduation year, batch, class,
registration number, city, country, occupation, organisation); configurable required fields; password policy;
email verification; no account discovery (an existing address gets the same answer and its owner is emailed);
per-network and per-address rate limits; optional email alert to the alumni office.

**Verification** — nobody is verified without an explicit method:
1. *Administrator* — queue with record-match evidence, private supporting documents (opening one is audited),
   approve / reject with a reason (emailed; the member corrects and resubmits) / revoke, bulk approval, history.
2. *Institutional records* — CSV import (dry run first, row-level errors, flexible column names, optional batch
   creation, up to 20 000 rows); a registration matching registration number + name + graduation year (+ date of
   birth when both are known) is verified automatically **only after the member proves the email or mobile number
   held on that record**; other matches are shown to administrators. Records with an email can be invited: the
   account is created verified and activates when the set-password link is used.
3. *Authorised institutional process* — verification codes issued by the alumni office (single or multi-use,
   expiry, optional batch restriction, shown once, stored hashed, revocable).
Verification swaps the member role (Unverified Alumni ↔ Verified Alumni / Student); verified school identity
fields are then locked for the member (administrators can still correct them); a registration number can belong
to one verified member only.

**Profiles** — personal, professional, experience, higher education / SST history, achievements (awards,
recognitions, publications, milestones, certifications), skills, photo (metadata stripped, WebP variants), links,
completion percentage with next steps, preview "as a member". **Privacy** — profile visibility (all members /
connections / hidden) and per-section visibility (email, mobile, birthday, location, career, education,
achievements, links); contact details private by default; hidden sections are excluded from search, filters,
facets and suggestions; administrators always see the full record.

**Directory** — grid / list, full-text prefix search (name, batch, year, profession, organisation, skills, city),
filters (batch, year, profession, organisation, industry, country, city), sorting, facets with counts, profile
preview, shareable filter URLs. **Connections** — request (with message) / accept / decline (sender not told) /
withdraw / remove, mutual requests auto-accept, follow / unfollow, report profile (moderated in Alumni
Management). Live notifications through the Socket.IO gateway after commit, plus email.

**Alumni dashboard** — widgets configurable by administrators (order, on / off, role audience): welcome banner,
verification status, statistics, connection requests, people you may know (batch / year / city / industry
scoring that respects privacy), alumni by country and by graduation year, profile completion, quick actions.

**Administration** — Alumni Management (search, filters, CSV export, add alumnus with invitation, full record,
edit verified details, reported profiles), Alumni Verification (queue, school records, codes), Batch Management
(CRUD, member counts, generate a range of years with automatic assignment), System Configuration → *Alumni &
registration* and *Dashboard widgets*, admin dashboard alumni figures (verified, pending, by year, by country,
recent registrations).

## Completed (Stage 1)

**Backend** — FastAPI modular monolith; consistent `{data, meta}` / `{error}` responses; OpenAPI at `/api/docs`.
- Authentication: login with lockout (configurable, minimum 3 attempts), argon2id, rotating refresh
  sessions with reuse detection, logout / logout-all / per-session revoke, password reset, password change,
  email verification, SMS OTP mobile verification, optional or enforced TOTP 2FA with recovery codes,
  password expiry, new-device sign-in alerts.
- RBAC: 122 permissions (28 admin modules × actions + 15 portal permissions), 15 default roles, custom roles,
  escalation protection, last-Super-Administrator protection, backend enforcement on every endpoint,
  staff 2FA gate.
- First-run setup wizard API (setup code, environment checks, logo upload, SMTP/storage tests, atomic completion).
- Configuration center: general, security, real-time (restart flags), branding (draft → publish), modules
  (data kept when disabled; endpoints return MODULE_DISABLED), feature flags (role-targeted), integrations
  (SMTP, generic HTTP SMS, local/MinIO/S3 storage; encrypted, masked, testable), message templates with
  preview and language variants, delivery log.
- Users admin (search, filters, CSV export, create with emailed set-password link, roles, status, unlock,
  sign-out, reset 2FA, soft delete), roles admin, audit log (filters, CSV export), media library (type
  sniffing, metadata stripping, WebP variants), system health (checks, pool, failed deliveries, p50/p95/p99).
- Celery worker/beat with transactional outbox for email/SMS; Socket.IO gateway (authenticated, Redis-backed,
  WebSocket transport, user rooms); Prometheus metrics; generated secrets (atomic across replicas).

**Frontend** — design language of the supplied dashboard reference (navy top bar / sidebar, purple
actions, white cards, stat tiles), runtime theming from published branding.
- Setup wizard (10 steps), sign-in (split screen), 2FA challenge, forgot/reset password, email verification.
- Admin: dashboard, users, roles & permission matrix, configuration center (all sections incl. live branding
  preview), communication center, media library, audit logs, system health.
- Portal: account profile (mobile verification), security (password, 2FA with QR, sessions, sign out everywhere).
- Public website (Next.js): branded landing page from settings.

**Deployment** — Docker Compose with 10 services + `ops`/`dev` profiles, generated infrastructure passwords
(no secrets in files), internal data network, health checks, restart policies, resource limits, log rotation,
dev and prod overlays, scripts (install, upgrade, backup, restore, health, logs, k6 load test), Makefile.

## Database migrations
- `0001_foundation` — users, roles, permissions, role_permissions, user_roles, sessions, login_attempts,
  user_verifications, system_settings, branding_settings, module_settings, integration_settings,
  feature_flags, message_templates, notification_logs, media_library, audit_logs.
- `0002_alumni_core` — alumni_profiles (GIN full-text index), alumni_education, alumni_employment,
  alumni_achievements, alumni_skills, alumni_connections (one row per pair), alumni_follows, alumni_batches,
  student_records, verification_codes, alumni_verification_events, profile_reports; media_library.private.

## Test results — Stage 2 (2026-11-24, local)
- Backend automated tests: **24 passed** (17 Stage 1 + 7 Stage 2: registration validation and no account discovery;
  unverified limits, reject → resubmit → approve → revoke with role changes and locked fields; record match only with
  proven contact, partial matches flagged, duplicate registration numbers refused; invitations and verification
  codes; profile sections, completion, photo, private documents never public; directory search / filters / privacy,
  connections, follows, reports, live events; batches, dashboard widgets, settings, export). Lint: clean.
- Browser walk-through (`frontend/app/scripts/e2e-stage2.mjs`): register → unverified dashboard → directory closed →
  profile / experience / skills / privacy → admin verifies from the queue → CSV import dry run + import → codes →
  batches / alumni / configuration → verified dashboard → directory search, grid / list, preview, connect → batchmate
  accepts from the dashboard → no horizontal overflow at 390 px: **pass, no page errors** (two mobile overflow bugs
  found and fixed during the run).

## Test results (2026-11-24, local: Python 3.12.8, PostgreSQL 17, in-memory Redis)
- Backend automated tests: **17 passed** (setup flow, lockout, refresh rotation & reuse detection, password
  reset, 2FA + recovery codes, password change & session revocation, forged tokens, RBAC enforcement, role
  escalation, last-admin protection, settings validation & audit, branding draft/publish, modules & flags,
  secrets never returned, upload validation, health & metrics, dashboard & profile). Lint: clean.
- Browser walk-through (Playwright): wizard → all 12 admin screens → create user → publish branding →
  portal → sign-out → member sign-in blocked from admin → mobile layout without horizontal overflow: **pass**.
- Latency, server-side (20 concurrent users, single process): p95 4 ms (site), 20 ms (me), 22 ms (users list),
  4 ms (dashboard). Client-side figures on the development PC were dominated by the load generator; the
  authoritative check is `make loadtest` against the Docker stack.

## Known issues / notes
- Docker images have not been built yet on the target machine — first `docker compose up -d --build` will
  confirm pinned image tags (postgres 16.6, redis 7.4.1, MinIO 2024-10-13, mailpit 1.21.8, k6 0.55.0).
- HTTPS: terminate TLS in front of nginx for now; a TLS overlay is planned for Stage 6.
- Payment providers intentionally not implemented (on hold).
- Navigation builder, CMS/page builder, custom fields, translations UI: Stage 5.
- Directory "active mentors" and "upcoming events" statistics and their dashboard widgets arrive with those modules (Stage 3).

## Deployment status
Not yet deployed. Commands for the first run are in README.md.

## API endpoints (Stages 1–2: 129)

| Area | Endpoint | Purpose |
|---|---|---|
| Admin: alumni | `GET /api/v1/admin/alumni/export` | Export alumni as CSV |
| Admin: alumni | `GET /api/v1/admin/alumni/{user_id}` | Full alumni record (all sections, documents, history, record match) |
| Admin: alumni | `GET /api/v1/admin/alumni` | List alumni and students |
| Admin: alumni | `GET /api/v1/admin/profile-reports` | Reported profiles |
| Admin: alumni | `GET /api/v1/admin/verification-codes` | Verification codes issued by the alumni office |
| Admin: alumni | `GET /api/v1/admin/verification/{user_id}/documents/{media_id}` | Open a supporting document |
| Admin: alumni | `GET /api/v1/admin/verification` | Verification queue |
| Admin: alumni | `PATCH /api/v1/admin/alumni/{user_id}` | Correct an alumni record (including verified school details) |
| Admin: alumni | `POST /api/v1/admin/alumni` | Add an alumnus (emails a link to set a password) |
| Admin: alumni | `POST /api/v1/admin/profile-reports/{report_id}/resolve` | Close a profile report |
| Admin: alumni | `POST /api/v1/admin/verification-codes/{code_id}/revoke` | Revoke a verification code |
| Admin: alumni | `POST /api/v1/admin/verification-codes` | Issue verification codes (shown once) |
| Admin: alumni | `POST /api/v1/admin/verification/bulk-approve` | Verify several members (strong record matches use the record) |
| Admin: alumni | `POST /api/v1/admin/verification/{user_id}/approve` | Verify a member |
| Admin: alumni | `POST /api/v1/admin/verification/{user_id}/reject` | Reject a registration (the member can correct and resubmit) |
| Admin: alumni | `POST /api/v1/admin/verification/{user_id}/revoke` | Revoke a verification |
| Admin: audit logs | `GET /api/v1/admin/audit-logs/export` | Export the audit log as CSV |
| Admin: audit logs | `GET /api/v1/admin/audit-logs` | Search the audit log |
| Admin: batches | `DELETE /api/v1/admin/batches/{batch_id}` | Delete a batch (members keep their graduation year) |
| Admin: batches | `GET /api/v1/admin/batches` | List batches with member counts |
| Admin: batches | `POST /api/v1/admin/batches/generate` | Create one batch per graduation year in a range |
| Admin: batches | `POST /api/v1/admin/batches` | Create a batch |
| Admin: batches | `PUT /api/v1/admin/batches/{batch_id}` | Update a batch |
| Admin: configuration | `GET /api/v1/admin/config/branding` | Draft and published branding |
| Admin: configuration | `GET /api/v1/admin/config/delivery-logs` | Email / SMS delivery log |
| Admin: configuration | `GET /api/v1/admin/config/feature-flags` | Feature flags |
| Admin: configuration | `GET /api/v1/admin/config/integrations` | All integrations (secrets masked) |
| Admin: configuration | `GET /api/v1/admin/config/modules` | Module switches |
| Admin: configuration | `GET /api/v1/admin/config/settings/{group}` | Read a settings group |
| Admin: configuration | `GET /api/v1/admin/config/templates` | Email / SMS templates |
| Admin: configuration | `POST /api/v1/admin/config/branding/discard` | Discard unpublished branding changes |
| Admin: configuration | `POST /api/v1/admin/config/branding/publish` | Publish the branding draft to every app |
| Admin: configuration | `POST /api/v1/admin/config/integrations/{kind}/test` | Test the saved integration (optionally send a test message) |
| Admin: configuration | `POST /api/v1/admin/config/templates/{template_id}/preview` | Render a template with sample values |
| Admin: configuration | `POST /api/v1/admin/config/templates/{template_id}/translations` | Add a language version |
| Admin: configuration | `PUT /api/v1/admin/config/branding` | Save the branding draft (not visible until published) |
| Admin: configuration | `PUT /api/v1/admin/config/feature-flags/{key}` | Turn a feature flag on/off, optionally for some roles only |
| Admin: configuration | `PUT /api/v1/admin/config/integrations/{kind}` | Save an integration (empty secret = keep the stored one) |
| Admin: configuration | `PUT /api/v1/admin/config/modules/{key}` | Enable or disable a module (data is kept) |
| Admin: configuration | `PUT /api/v1/admin/config/settings/{group}` | Save a settings group |
| Admin: configuration | `PUT /api/v1/admin/config/templates/{template_id}` | Edit a template |
| Admin: dashboard | `GET /api/v1/admin/dashboard` | Headline figures for the admin dashboard |
| Admin: media library | `DELETE /api/v1/admin/media/{media_id}` | Delete a file (kept in storage until purged) |
| Admin: media library | `GET /api/v1/admin/media` | Browse the media library |
| Admin: media library | `PATCH /api/v1/admin/media/{media_id}` | Edit alternative text |
| Admin: media library | `POST /api/v1/admin/media` | Upload a file |
| Admin: roles and permissions | `DELETE /api/v1/admin/roles/{role_id}` | Delete a custom role |
| Admin: roles and permissions | `GET /api/v1/admin/roles/catalogue` | All permissions grouped by module |
| Admin: roles and permissions | `GET /api/v1/admin/roles` | List roles |
| Admin: roles and permissions | `POST /api/v1/admin/roles` | Create a custom role |
| Admin: roles and permissions | `PUT /api/v1/admin/roles/{role_id}` | Update a role's name, description and permissions |
| Admin: student records | `DELETE /api/v1/admin/student-records/{record_id}` | Delete a student record |
| Admin: student records | `GET /api/v1/admin/student-records/template` | CSV template for the import |
| Admin: student records | `GET /api/v1/admin/student-records` | Browse imported student records |
| Admin: student records | `POST /api/v1/admin/student-records/import` | Import student records from CSV (dry_run=true validates without saving) |
| Admin: student records | `POST /api/v1/admin/student-records/invite` | Create verified accounts for records with an email and send invitations |
| Admin: users | `DELETE /api/v1/admin/users/{user_id}` | Delete a user (soft delete) |
| Admin: users | `GET /api/v1/admin/users/export` | Export users as CSV |
| Admin: users | `GET /api/v1/admin/users/{user_id}` | Get a user |
| Admin: users | `GET /api/v1/admin/users` | List users |
| Admin: users | `PATCH /api/v1/admin/users/{user_id}` | Update a user (name, phone, roles, status) |
| Admin: users | `POST /api/v1/admin/users/{user_id}/reset-mfa` | Turn off two-factor authentication for a user who lost their device |
| Admin: users | `POST /api/v1/admin/users/{user_id}/sign-out` | End all sessions of a user |
| Admin: users | `POST /api/v1/admin/users/{user_id}/unlock` | Clear a sign-in lockout |
| Admin: users | `POST /api/v1/admin/users` | Create a user |
| Alumni portal | `DELETE /api/v1/alumni/connections/{request_id}` | Withdraw a request or remove a connection |
| Alumni portal | `DELETE /api/v1/alumni/me/achievements/{item_id}` | Remove an entry from your achievements |
| Alumni portal | `DELETE /api/v1/alumni/me/education/{item_id}` | Remove an entry from your education |
| Alumni portal | `DELETE /api/v1/alumni/me/employment/{item_id}` | Remove an entry from your employment |
| Alumni portal | `DELETE /api/v1/alumni/me/photo` | Remove your profile photo |
| Alumni portal | `DELETE /api/v1/alumni/me/verification/documents/{media_id}` | Remove a supporting document |
| Alumni portal | `DELETE /api/v1/alumni/profiles/{user_id}/follow` | Stop following a member |
| Alumni portal | `GET /api/v1/alumni/connections` | Your connections, requests and follows |
| Alumni portal | `GET /api/v1/alumni/dashboard` | Your dashboard (widgets chosen by the administrators) |
| Alumni portal | `GET /api/v1/alumni/directory/facets` | Filter options for the directory |
| Alumni portal | `GET /api/v1/alumni/directory` | Search the alumni directory |
| Alumni portal | `GET /api/v1/alumni/me/verification/documents/{media_id}` | Download one of your supporting documents |
| Alumni portal | `GET /api/v1/alumni/me/verification/history` | Your verification history |
| Alumni portal | `GET /api/v1/alumni/me` | Your full profile, privacy settings, completion and verification status |
| Alumni portal | `GET /api/v1/alumni/profiles/{user_id}` | View an alumni profile (privacy applied) |
| Alumni portal | `POST /api/v1/alumni/connections/{request_id}/accept` | Accept a connection request |
| Alumni portal | `POST /api/v1/alumni/connections/{request_id}/decline` | Decline a connection request |
| Alumni portal | `POST /api/v1/alumni/connections` | Send a connection request |
| Alumni portal | `POST /api/v1/alumni/me/achievements` | Add an entry to your achievements |
| Alumni portal | `POST /api/v1/alumni/me/education` | Add an entry to your education |
| Alumni portal | `POST /api/v1/alumni/me/employment` | Add an entry to your employment |
| Alumni portal | `POST /api/v1/alumni/me/photo` | Upload your profile photo |
| Alumni portal | `POST /api/v1/alumni/me/verification/code` | Verify with a code issued by the alumni office |
| Alumni portal | `POST /api/v1/alumni/me/verification/documents` | Attach a supporting document (kept private) |
| Alumni portal | `POST /api/v1/alumni/me/verification` | Submit (or resubmit) your profile for verification |
| Alumni portal | `POST /api/v1/alumni/profiles/{user_id}/follow` | Follow a member |
| Alumni portal | `POST /api/v1/alumni/profiles/{user_id}/report` | Report a profile to the administrators |
| Alumni portal | `PUT /api/v1/alumni/me/achievements/{item_id}` | Update an entry of your achievements |
| Alumni portal | `PUT /api/v1/alumni/me/education/{item_id}` | Update an entry of your education |
| Alumni portal | `PUT /api/v1/alumni/me/employment/{item_id}` | Update an entry of your employment |
| Alumni portal | `PUT /api/v1/alumni/me/privacy` | Choose who can see your profile and each section |
| Alumni portal | `PUT /api/v1/alumni/me/skills` | Replace your skills list |
| Alumni portal | `PUT /api/v1/alumni/me` | Update your personal and professional details |
| Authentication | `DELETE /api/v1/auth/sessions/{session_id}` | End one session |
| Authentication | `GET /api/v1/auth/me` | Current user, roles and permissions |
| Authentication | `GET /api/v1/auth/sessions` | Active sessions of the current user |
| Authentication | `PATCH /api/v1/auth/me` | Update your own name, mobile number or language |
| Authentication | `POST /api/v1/auth/email/resend` | Resend the verification email |
| Authentication | `POST /api/v1/auth/email/verify` | Confirm an email address |
| Authentication | `POST /api/v1/auth/login/mfa` | Complete sign-in with a two-factor code |
| Authentication | `POST /api/v1/auth/login` | Sign in with email and password |
| Authentication | `POST /api/v1/auth/logout-all` | Sign out of every device |
| Authentication | `POST /api/v1/auth/logout` | Sign out of this device |
| Authentication | `POST /api/v1/auth/mfa/disable` | Turn off two-factor authentication |
| Authentication | `POST /api/v1/auth/mfa/enable` | Confirm two-factor setup with a code; returns recovery codes |
| Authentication | `POST /api/v1/auth/mfa/setup` | Start two-factor setup (returns the authenticator secret) |
| Authentication | `POST /api/v1/auth/password/change` | Change password (signs out other devices) |
| Authentication | `POST /api/v1/auth/password/forgot` | Email a password-reset link |
| Authentication | `POST /api/v1/auth/password/reset` | Set a new password using a reset link |
| Authentication | `POST /api/v1/auth/phone/send-code` | Send a mobile verification code by SMS |
| Authentication | `POST /api/v1/auth/phone/verify` | Confirm the mobile number with the SMS code |
| Authentication | `POST /api/v1/auth/refresh` | Exchange the refresh cookie for a new access token |
| Health | `GET /api/v1/admin/health` | System health, queue backlog and recent API latency (p50/p95/p99) |
| Health | `GET /api/v1/health/live` | Liveness probe |
| Health | `GET /api/v1/health/ready` | Readiness probe (database + Redis) |
| Public | `GET /api/v1/public/site` | Site identity, published branding, enabled modules |
| Registration | `GET /api/v1/public/batches` | Active batches (for registration and filters) |
| Registration | `POST /api/v1/auth/register` | Register as an alumnus or current student |
| Setup wizard | `GET /api/v1/setup/status` | Is installation required? Includes environment checks. |
| Setup wizard | `POST /api/v1/setup/complete` | Finish installation: settings + first administrator |
| Setup wizard | `POST /api/v1/setup/test-email` | Test SMTP settings before saving |
| Setup wizard | `POST /api/v1/setup/test-storage` | Test storage settings before saving |
| Setup wizard | `POST /api/v1/setup/upload` | Upload a logo or image during setup |
| Setup wizard | `POST /api/v1/setup/verify-code` | Check the setup code |
