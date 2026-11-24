# Development progress — SST Alumni Connect

Last updated: 2026-11-24 · Current stage: **1 — Foundation (complete, awaiting first Docker run)**

## Stage plan

| Stage | Scope | Status |
|---|---|---|
| 1 Foundation | architecture, repository, Docker Compose, database, authentication, RBAC, setup wizard, branding, configuration center core | ✅ built & tested locally |
| 2 Alumni core | registration (alumni fields, institutional record matching), verification, profiles, batches, directory, alumni dashboard | ⏳ next |
| 3 Engagement | community feed (real-time), messaging, groups, events + QR check-in, jobs, mentorship, achievements | ⏳ |
| 4 Institutional | donations (gateway-less until providers are chosen), scholarships, newsletters, notifications, gallery | ⏳ |
| 5 Administration | CMS + drag-and-drop page builder, navigation builder, custom fields, localisation (Urdu/RTL), reports & exports | ⏳ |
| 6 Production readiness | security testing, load tests at target scale, HTTPS overlay, handbooks, ERD, checklist | ⏳ |

Decisions: FastAPI backend (architectural revision), Next.js for public pages + React/Vite for portal/admin,
payments on hold, generic HTTP SMS provider, students both self-register and are imported, p95 latency
budget 200 ms for API reads.

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

## Deployment status
Not yet deployed. Commands for the first run are in README.md.

## API endpoints (Stage 1)

| Area | Endpoint | Purpose |
|---|---|---|
| Admin: audit logs | `GET /api/v1/admin/audit-logs` | Search the audit log |
| Admin: audit logs | `GET /api/v1/admin/audit-logs/export` | Export the audit log as CSV |
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
| Admin: roles and permissions | `GET /api/v1/admin/roles` | List roles |
| Admin: roles and permissions | `GET /api/v1/admin/roles/catalogue` | All permissions grouped by module |
| Admin: roles and permissions | `POST /api/v1/admin/roles` | Create a custom role |
| Admin: roles and permissions | `PUT /api/v1/admin/roles/{role_id}` | Update a role's name, description and permissions |
| Admin: users | `DELETE /api/v1/admin/users/{user_id}` | Delete a user (soft delete) |
| Admin: users | `GET /api/v1/admin/users` | List users |
| Admin: users | `GET /api/v1/admin/users/export` | Export users as CSV |
| Admin: users | `GET /api/v1/admin/users/{user_id}` | Get a user |
| Admin: users | `PATCH /api/v1/admin/users/{user_id}` | Update a user (name, phone, roles, status) |
| Admin: users | `POST /api/v1/admin/users` | Create a user |
| Admin: users | `POST /api/v1/admin/users/{user_id}/reset-mfa` | Turn off two-factor authentication for a user who lost their device |
| Admin: users | `POST /api/v1/admin/users/{user_id}/sign-out` | End all sessions of a user |
| Admin: users | `POST /api/v1/admin/users/{user_id}/unlock` | Clear a sign-in lockout |
| Authentication | `DELETE /api/v1/auth/sessions/{session_id}` | End one session |
| Authentication | `GET /api/v1/auth/me` | Current user, roles and permissions |
| Authentication | `GET /api/v1/auth/sessions` | Active sessions of the current user |
| Authentication | `PATCH /api/v1/auth/me` | Update your own name, mobile number or language |
| Authentication | `POST /api/v1/auth/email/resend` | Resend the verification email |
| Authentication | `POST /api/v1/auth/email/verify` | Confirm an email address |
| Authentication | `POST /api/v1/auth/login` | Sign in with email and password |
| Authentication | `POST /api/v1/auth/login/mfa` | Complete sign-in with a two-factor code |
| Authentication | `POST /api/v1/auth/logout` | Sign out of this device |
| Authentication | `POST /api/v1/auth/logout-all` | Sign out of every device |
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
| Setup wizard | `GET /api/v1/setup/status` | Is installation required? Includes environment checks. |
| Setup wizard | `POST /api/v1/setup/complete` | Finish installation: settings + first administrator |
| Setup wizard | `POST /api/v1/setup/test-email` | Test SMTP settings before saving |
| Setup wizard | `POST /api/v1/setup/test-storage` | Test storage settings before saving |
| Setup wizard | `POST /api/v1/setup/upload` | Upload a logo or image during setup |
| Setup wizard | `POST /api/v1/setup/verify-code` | Check the setup code |
