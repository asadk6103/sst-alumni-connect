# Development progress — SST Alumni Connect

Last updated: 2026-11-25 · Current stage: **Web platform complete** (Stages 1–6) · next: mobile app

## Stage plan

| Stage | Scope | Status |
|---|---|---|
| 1 Foundation | architecture, repository, Docker Compose, database, authentication, RBAC, setup wizard, branding, configuration center core | ✅ built & tested locally |
| 2 Alumni core | registration (alumni fields, institutional record matching), verification, profiles, batches, directory, alumni dashboard | ✅ built & tested locally |
| 3 Engagement | community feed (real-time), messaging, groups, events + QR check-in, jobs, mentorship, achievements | ✅ built & tested locally |
| 4 Institutional | donations (gateway-less until providers are chosen), scholarships, newsletters, notifications, gallery | ✅ built & tested locally |
| 5 Administration | CMS + drag-and-drop page builder, navigation builder, custom fields, localisation (Urdu/RTL), reports & exports | ✅ built & tested locally |
| 6 Production readiness | security testing, load tests at target scale, HTTPS overlay, handbooks, ERD, checklist | ✅ built & tested locally; Docker validation on the server |

Decisions: FastAPI backend (architectural revision), Next.js for public pages + React/Vite for portal/admin,
payments on hold, generic HTTP SMS provider, students both self-register and are imported, p95 latency
budget 200 ms for API reads.

## Completed (Stage 6 — Production readiness)

**Security** — new test suite sweeps every admin route (members get 401/403 for every method) and every private
route (anonymous → 401/403), injection payloads in all search boxes, security headers, cross-site cookie requests
(new Origin check on refresh / logout), object-level access (donations, receipts, conversations, private files).
**Privacy** — members download all their data (JSON, audit-logged, secrets excluded) and request account deletion
(password confirmation); administrators approve (anonymisation: identity, profile, network, files and preferences
erased; posts/messages show "Deleted member"; donation records kept without name; signed out everywhere) or decline
with a reason. Migration `0007_privacy`.
**HTTPS** — `docker-compose.https.yml` TLS edge (80 → 443 redirect, HSTS, TLS 1.2/1.3, WebSocket, Let's Encrypt
webroot), `make up-https`.
**Performance** — k6 load test extended to the member screens and website (p95 < 200 ms thresholds); local service
times recorded in the testing report.
**Documentation** — deployment guide (HTTPS), production checklist, backup & restore guide, generated ERD (81 tables)
and API reference (394 endpoints + OpenAPI JSON), administrator handbook, member guide, testing report.

## Completed (Stage 5 — Administration)

**CMS & page builder** — public pages built from 13 block types (hero, image + text, rich text, statistics with live
figures, alumni profiles, featured alumni, events, news, gallery, testimonials, call to action, contact, newsletter).
Drag-and-drop ordering (plus up/down buttons), hide / duplicate / delete blocks, draft vs published versions (editing
never changes the live page until published), publish now or schedule, unpublish, discard draft, duplicate page,
slug management with reserved paths, SEO title / description with search-result preview, featured image, preview on
the real website in an iframe with desktop / tablet / mobile widths (short-lived signed preview link). Rich text is
escaped on the server, then a small formatting syntax is applied (no HTML injection). Link fields accept only paths,
https, mailto and tel. Home page is selectable (Configuration → Public website).

**News & announcements** — news, announcements and success stories; drafts, publish / schedule, pin, members-only
posts (portal only), SEO fields, cover image; website and portal feeds with related articles.

**Navigation builder** — header menu (one level of sub-links) and footer links; website sections, pages or web
addresses; Urdu labels; links to unpublished pages are hidden automatically.

**Website** (Next.js) — shared header / footer from the menus and settings, language switch, CMS pages at `/<slug>`,
`/news`, `/news/<slug>`, `/events`, `/events/<id>` (no meeting links, batch-only events excluded), `/gallery`,
`/gallery/<id>`, `/distinguished-alumni` (consent only), `/contact` (form with honeypot and rate limit → admin inbox +
email to the office), `/newsletter`, `/preview`, 404 page, `sitemap.xml`, `robots.txt`, Open Graph metadata.

**Custom fields** — field builder for alumni profiles (and registration), job posts, events, mentor profiles and
donations; 12 types; required, visibility (public / members / connections / owner + staff), validation (length,
range, pattern, choice counts, custom message), conditional visibility, ordering, Urdu labels. Values are stored in a
JSONB column per entity — no schema change per field. Server validation with per-field errors; file answers are
private and opened only by people allowed to see the field. Forms and display added to registration, profile
(Additional details), job form/page, event editor/page, mentor form/profile and the donation pledge.

**Localisation** — English and Urdu built in, more languages from the admin screen; translation editor with search,
"untranslated only", CSV export / import; member's language saved on the account; right-to-left layout and Urdu fonts.
The administration console stays in English. A test keeps the frontend keys and the catalogue in sync.

**Reports & analytics** — 13 reports (registration trends, graduation year, location, profession, organisation,
engagement, events, mentorship, jobs, donations, scholarships, profile completion, verification) with date presets and
custom ranges, charts (line, bar, horizontal bar, donut with tooltips and legends), data tables, CSV / Excel / PDF
exports (built-in writers, no extra libraries) and print layout. Reports are aggregates only; staff without access to
alumni records see groups under 3 merged into "Other". Every export is audit-logged.

**Configuration centre** — new sections: Public website (home page, footer, social links, events, contact form) and
Languages & translations. **Audit logs** cover all new administrative actions.

## Completed (Stage 4 — Institutional support)

**Notifications** — in-app notification centre (bell with unread badge, full page, mark read / all, delete), live push after
commit, per-category preferences for in-app and email (connections, verification, community, events, jobs, mentorship,
achievements, donations); every member-facing email now goes through these preferences (security emails always send).

**Donations** — campaigns for the seven spec categories with goal, dates, image and progress; pledges with a unique
reference and the bank transfer / cash / cheque details from System Configuration → Donations; finance confirms receipt
(payment reference, notes) which issues a numbered receipt (printable page, emailed), updates campaign totals and donor
count; offline donations recorded directly; anonymous gifts; donor wall only with consent; cancel, refund; statistics by
month and purpose; CSV export. **Payment gateways stay disabled** (as decided) — no card data is ever handled; the
configuration for providers remains for when credentials are supplied and verified.

**Scholarships** — funds with criteria, amount and sponsor, linked fundraising campaigns, awards recorded privately by
finance staff (recipients never shown to members), awards CSV.

**Newsletters** — public double opt-in (confirm link), member opt-in / out, one-click unsubscribe in every issue,
composing with a safe formatting syntax (all input escaped), preview, test send, audiences (subscribers + verified alumni,
verified alumni, one batch), send now or schedule (Celery beat), resumable sending that never mails an address twice,
subscriber list, CSV export and consent-based import.

**Gallery** — albums (members-only or public), multi-photo upload with captions, cover choice, publish / unpublish, portal
gallery with a photo viewer and public endpoints for the website.

## Completed (Stage 3 — Engagement)

**Community** — feed (cursor pagination, pinned announcements, following / mine / search), text and photo posts,
reactions, comments with replies, shares, batch communities (automatic, private), interest groups and forums
(member proposals approved by moderators, join approval, group moderators), reports, moderation queue (hide /
delete / dismiss with reasons shown to the author), moderation log. Live feed and comment updates per room.

**Messaging** — one-to-one (connections and batchmates; blocks win) and group chats up to 100 members, private
attachments, replies, edit / delete, reactions, delivered and read receipts, unread counters and badge, conversation
search, mute / archive / pin, idempotent sends (client_id) persisted before the acknowledgement, over REST or the
socket. Gateway: authorised room subscriptions (user, feed, group, batch, conversation, event, admin), multi-device
presence (Redis TTL + heartbeat, offline only when the last device goes), typing indicators.

**Events** — reunions, batch reunions (batch-only visibility), webinars (link shown to attendees), seminars, sports,
career sessions; capacity with automatic waitlist promotion, guests, deadlines, QR tickets and check-in (camera
where supported, code entry everywhere), manual check-in, attendance export, calendar file, reminders 24 h before
(Celery beat), cancellation emails, gallery, feedback and ratings.

**Careers** — jobs and internships with filters, saved jobs, alumni referrals, postings reviewed by the career office,
employer registration (approval grants the Employer role), private CVs, applications with status tracking and
emails, poster notes, career resources, categories, CSV export.

**Mentorship** — mentor applications (industry, expertise, skills, hours, formats, mentee types, capacity) approved by
the coordinator, mentor directory with ratings and testimonials, requests from students and alumni, accept / decline,
sessions with outcomes, completion, two-way feedback, history, CSV export.

**Achievements** — nominations by members, review / edit / publish by the alumni office, distinguished alumni, alumni
of the month, success stories; publication on the public website only with the member's consent.

Dashboard widgets added: upcoming events, latest community posts, latest jobs, recent achievements, mentor
recommendations; statistics now include active mentors and upcoming events.

Fixes found while building Stage 3: kombu pinned to 5.4.2 (5.7 broke Celery's Redis transport with redis-py 5, so
emails could not be queued), the real-time gateway now loads its heartbeat settings at start-up, the Redis client
retries after a Redis restart, batch communities and staff profiles are created race-free.

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
- `0003_community_messaging` — discussion_groups, group_members, posts, post_media, comments, reactions, reports,
  moderation_actions, conversations, conversation_members, conversation_settings, messages, message_attachments,
  message_receipts, message_reactions, blocked_users.
- `0004_engagement` — events, event_registrations, event_attendance, event_media, event_feedback, employers,
  job_categories, job_posts, job_applications, saved_jobs, resumes, career_resources, mentors, mentorship_requests,
  mentorship_sessions, mentorship_feedback, achievements.
- `0005_institutional` — notifications, notification_preferences, donation_campaigns, donations, scholarships,
  scholarship_awards, newsletter_subscribers, newsletters, newsletter_deliveries, gallery_albums, gallery_photos.
- `0006_administration` — cms_pages, news_posts, nav_menus, contact_messages, custom_fields, languages, translations;
  `custom_fields` JSONB on alumni_profiles, job_posts, events, mentors, donations.

## Test results — Stage 6 (2026-11-25, local)
- Backend automated tests: **51 passed** (adds 7 security / privacy tests). Lint clean; both frontends type-check.
- Browser walk-through (`e2e-stage6.mjs`): data download → deletion request → admin approval → account signed out →
  mobile: **pass, no page errors**. Full report: [docs/TESTING_REPORT.md](docs/TESTING_REPORT.md).
- Docker deployment validation is run on the target server (commands in the testing report §5).

## Test results — Stage 5 (2026-11-25, local)
- Backend automated tests: **44 passed** (adds pages draft / preview / publish / schedule / home-page protection and
  link safety, news and members-only posts, navigation, contact form with honeypot and rate limit, custom fields
  validation / conditions / visibility / private files, localisation overrides and CSV import, all 13 reports with
  CSV / Excel / PDF exports and small-group suppression, frontend translation keys). Lint: clean.
- Browser walk-through (`e2e-stage5.mjs`): page builder → preview (desktop, mobile) → publish → menu link on the
  website → news → contact form → inbox → custom field answered by a member → Urdu RTL → reports with Excel / PDF →
  website and admin at 390 px: **pass, no page errors**.

## Test results — Stage 4 (2026-11-25, local)
- Backend automated tests: **37 passed** (adds notifications and preferences, donations from pledge to receipt and
  refund, scholarships privacy, newsletter double opt-in / safe rendering / resumable sending / unsubscribe, gallery
  visibility). Lint: clean.
- Browser walk-through (`e2e-stage4.mjs`): bank details → campaign → pledge with transfer instructions → finance confirms →
  receipt and bell notification → newsletter compose / preview / send → album with photos → member gallery → mobile: **pass,
  no page errors**.

## Test results — Stage 3 (2026-11-25, local)
- Backend automated tests: **33 passed** (community feed / reactions / comments / shares / moderation, groups and
  batch communities, messaging rules / idempotency / receipts / blocks / private attachments, multi-device presence,
  gateway room authorisation and socket send, events with waitlist / QR check-in / reminders / feedback, jobs from
  posting to hiring, mentorship from application to feedback, achievements with consent). Lint: clean.
- Browser walk-throughs (`e2e-stage3-community.mjs`, `e2e-stage3-engagement.mjs`): **pass, no page errors**; found and
  fixed a race on batch community creation and a stale registrations list after check-in.
- Not demonstrable on this PC: cross-process live push (API → Redis pub/sub → gateway). The local in-memory Redis
  does not push pub/sub messages; Docker uses real Redis. Run `LIVE=1 node scripts/e2e-stage3-community.mjs …`
  against the Docker stack to verify live delivery, typing indicators and receipts end to end.

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


## Deployment status
Not yet deployed. Commands for the first run are in README.md.

## API endpoints (Stages 1–5: 387)

| Area | Endpoint | Purpose |
|---|---|---|
| Achievements | `GET /api/v1/achievements/nominations/mine` | Nominations you made and achievements about you |
| Achievements | `GET /api/v1/achievements/{achievement_id}` | An achievement |
| Achievements | `GET /api/v1/achievements` | Published alumni achievements |
| Achievements | `POST /api/v1/achievements/nominations` | Nominate an alumnus (yourself included) |
| Achievements | `POST /api/v1/achievements/{achievement_id}/consent` | Allow (or not) your achievement on the public website |
| Admin: achievements | `DELETE /api/v1/admin/achievements/{achievement_id}` | Delete an achievement |
| Admin: achievements | `GET /api/v1/admin/achievements` | Nominations and achievements |
| Admin: achievements | `POST /api/v1/admin/achievements/{achievement_id}/review` | Approve, publish, unpublish or reject |
| Admin: achievements | `POST /api/v1/admin/achievements` | Add an achievement directly |
| Admin: achievements | `PUT /api/v1/admin/achievements/{achievement_id}` | Edit an achievement (story, image, featuring) |
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
| Admin: community | `GET /api/v1/admin/community/groups` | All groups, including proposals waiting for approval |
| Admin: community | `GET /api/v1/admin/community/moderation-log` | Moderation history |
| Admin: community | `GET /api/v1/admin/community/posts` | All posts (search, status, group) |
| Admin: community | `GET /api/v1/admin/community/reports` | Reported posts and comments |
| Admin: community | `POST /api/v1/admin/community/comments/{comment_id}/moderate` | Hide, restore or delete a comment |
| Admin: community | `POST /api/v1/admin/community/groups/{group_id}/decide` | Approve, reject, archive or restore a group |
| Admin: community | `POST /api/v1/admin/community/groups` | Create a group (staff) |
| Admin: community | `POST /api/v1/admin/community/posts/{post_id}/moderate` | Hide, restore, delete, pin or unpin a post |
| Admin: community | `POST /api/v1/admin/community/reports/{target_type}/{target_id}` | Decide on a reported post or comment |
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
| Admin: custom fields | `DELETE /api/v1/admin/custom-fields/{field_id}` | Delete a custom field (stored answers are kept but no longer shown) |
| Admin: custom fields | `GET /api/v1/admin/custom-fields` | List custom fields of a form |
| Admin: custom fields | `POST /api/v1/admin/custom-fields` | Add a custom field |
| Admin: custom fields | `PUT /api/v1/admin/custom-fields/order` | Reorder the fields of a form |
| Admin: custom fields | `PUT /api/v1/admin/custom-fields/{field_id}` | Edit a custom field (its key and form cannot change) |
| Admin: dashboard | `GET /api/v1/admin/dashboard` | Headline figures for the admin dashboard |
| Admin: donations | `GET /api/v1/admin/donations/campaigns` | All campaigns |
| Admin: donations | `GET /api/v1/admin/donations/export` | Export donations (CSV) |
| Admin: donations | `GET /api/v1/admin/donations/stats` | Donation statistics |
| Admin: donations | `GET /api/v1/admin/donations/{donation_id}/receipt` | Receipt (staff) |
| Admin: donations | `GET /api/v1/admin/donations` | Donations and pledges |
| Admin: donations | `POST /api/v1/admin/donations/campaigns/{campaign_id}/status` | Open, close or unpublish a campaign |
| Admin: donations | `POST /api/v1/admin/donations/campaigns` | Create a campaign (draft) |
| Admin: donations | `POST /api/v1/admin/donations/{donation_id}/confirm` | Confirm that a pledge was received (issues the receipt) |
| Admin: donations | `POST /api/v1/admin/donations/{donation_id}/status` | Cancel a pledge or mark a donation as refunded |
| Admin: donations | `POST /api/v1/admin/donations` | Record a donation received offline (issues the receipt) |
| Admin: donations | `PUT /api/v1/admin/donations/campaigns/{campaign_id}` | Edit a campaign |
| Admin: events | `DELETE /api/v1/admin/events/{event_id}/checkin/{user_id}` | Undo a check-in |
| Admin: events | `DELETE /api/v1/admin/events/{event_id}/media/{media_id}` | Remove a gallery photo |
| Admin: events | `DELETE /api/v1/admin/events/{event_id}` | Delete a draft event |
| Admin: events | `GET /api/v1/admin/events/{event_id}/feedback` | Feedback from attendees |
| Admin: events | `GET /api/v1/admin/events/{event_id}/registrations/export` | Export registrations and attendance (CSV) |
| Admin: events | `GET /api/v1/admin/events/{event_id}/registrations` | Registrations and attendance |
| Admin: events | `GET /api/v1/admin/events/{event_id}` | One event (for editing) |
| Admin: events | `GET /api/v1/admin/events` | All events |
| Admin: events | `POST /api/v1/admin/events/{event_id}/cancel` | Cancel an event (registrants are emailed) |
| Admin: events | `POST /api/v1/admin/events/{event_id}/checkin` | Check in an attendee (QR code or manual) |
| Admin: events | `POST /api/v1/admin/events/{event_id}/media` | Add a photo to the event gallery |
| Admin: events | `POST /api/v1/admin/events/{event_id}/publish` | Publish an event |
| Admin: events | `POST /api/v1/admin/events` | Create an event (draft) |
| Admin: events | `PUT /api/v1/admin/events/{event_id}` | Update an event |
| Admin: gallery | `DELETE /api/v1/admin/gallery/{album_id}/photos/{media_id}` | Remove a photo |
| Admin: gallery | `DELETE /api/v1/admin/gallery/{album_id}` | Delete an album |
| Admin: gallery | `GET /api/v1/admin/gallery/{album_id}` | An album (staff) |
| Admin: gallery | `GET /api/v1/admin/gallery` | All albums |
| Admin: gallery | `PATCH /api/v1/admin/gallery/{album_id}/photos/{media_id}` | Edit a caption |
| Admin: gallery | `POST /api/v1/admin/gallery/{album_id}/photos` | Add a photo |
| Admin: gallery | `POST /api/v1/admin/gallery/{album_id}/publish` | Publish or unpublish |
| Admin: gallery | `POST /api/v1/admin/gallery` | Create an album (draft) |
| Admin: gallery | `PUT /api/v1/admin/gallery/{album_id}` | Edit an album |
| Admin: jobs | `DELETE /api/v1/admin/jobs/categories/{category_id}` | Remove a job category |
| Admin: jobs | `DELETE /api/v1/admin/jobs/resources/{resource_id}` | Delete a career resource |
| Admin: jobs | `DELETE /api/v1/admin/jobs/{job_id}` | Delete a job |
| Admin: jobs | `GET /api/v1/admin/jobs/employers` | Employer registrations |
| Admin: jobs | `GET /api/v1/admin/jobs/export` | Export jobs (CSV) |
| Admin: jobs | `GET /api/v1/admin/jobs/resources` | Career resources (all) |
| Admin: jobs | `GET /api/v1/admin/jobs` | All job postings |
| Admin: jobs | `POST /api/v1/admin/jobs/categories` | Add a job category |
| Admin: jobs | `POST /api/v1/admin/jobs/employers/{employer_id}/decide` | Approve or reject an employer |
| Admin: jobs | `POST /api/v1/admin/jobs/resources` | Add a career resource |
| Admin: jobs | `POST /api/v1/admin/jobs/{job_id}/approve` | Approve and list a job |
| Admin: jobs | `POST /api/v1/admin/jobs/{job_id}/reject` | Reject a job (the poster can correct and resubmit) |
| Admin: jobs | `PUT /api/v1/admin/jobs/resources/{resource_id}` | Edit a career resource |
| Admin: localization | `DELETE /api/v1/admin/localization/languages/{code}` | Remove a language and its translations |
| Admin: localization | `GET /api/v1/admin/localization/languages` | All languages |
| Admin: localization | `GET /api/v1/admin/localization/translations/{code}/export` | Download translations as CSV (key, English, translation) |
| Admin: localization | `GET /api/v1/admin/localization/translations/{code}` | Strings of a language with their English source |
| Admin: localization | `POST /api/v1/admin/localization/languages` | Add a language |
| Admin: localization | `POST /api/v1/admin/localization/translations/{code}/import` | Upload a translations CSV (key, english, translation) |
| Admin: localization | `PUT /api/v1/admin/localization/languages/{code}` | Edit a language |
| Admin: localization | `PUT /api/v1/admin/localization/translations/{code}` | Save translations (empty value restores the built-in text) |
| Admin: media library | `DELETE /api/v1/admin/media/{media_id}` | Delete a file (kept in storage until purged) |
| Admin: media library | `GET /api/v1/admin/media` | Browse the media library |
| Admin: media library | `PATCH /api/v1/admin/media/{media_id}` | Edit alternative text |
| Admin: media library | `POST /api/v1/admin/media` | Upload a file |
| Admin: mentorship | `GET /api/v1/admin/mentorship/export` | Export mentorships (CSV) |
| Admin: mentorship | `GET /api/v1/admin/mentorship/mentors` | Mentor applications and mentors |
| Admin: mentorship | `GET /api/v1/admin/mentorship/requests` | All mentorships |
| Admin: mentorship | `POST /api/v1/admin/mentorship/mentors/{user_id}/decide` | Approve or reject a mentor application |
| Admin: news | `DELETE /api/v1/admin/news/{news_id}` | Delete an article |
| Admin: news | `GET /api/v1/admin/news/{news_id}` | An article |
| Admin: news | `GET /api/v1/admin/news` | Articles |
| Admin: news | `POST /api/v1/admin/news/{news_id}/publish` | Publish now, schedule, or return to draft |
| Admin: news | `POST /api/v1/admin/news` | Write an article (draft) |
| Admin: news | `PUT /api/v1/admin/news/{news_id}` | Edit an article |
| Admin: newsletters | `DELETE /api/v1/admin/newsletters/{newsletter_id}` | Delete a draft |
| Admin: newsletters | `GET /api/v1/admin/newsletters/subscribers/export` | Export subscribers (CSV) |
| Admin: newsletters | `GET /api/v1/admin/newsletters/subscribers/list` | Subscribers |
| Admin: newsletters | `GET /api/v1/admin/newsletters/{newsletter_id}` | One newsletter |
| Admin: newsletters | `GET /api/v1/admin/newsletters` | Newsletters |
| Admin: newsletters | `POST /api/v1/admin/newsletters/subscribers/import` | Import subscribers who consented elsewhere (CSV: email, name) |
| Admin: newsletters | `POST /api/v1/admin/newsletters/{newsletter_id}/cancel` | Cancel a scheduled newsletter (back to draft) |
| Admin: newsletters | `POST /api/v1/admin/newsletters/{newsletter_id}/preview` | Rendered HTML of the issue |
| Admin: newsletters | `POST /api/v1/admin/newsletters/{newsletter_id}/send` | Send now or schedule |
| Admin: newsletters | `POST /api/v1/admin/newsletters/{newsletter_id}/test` | Send a test copy to yourself |
| Admin: newsletters | `POST /api/v1/admin/newsletters` | Create a newsletter (draft) |
| Admin: newsletters | `PUT /api/v1/admin/newsletters/{newsletter_id}` | Edit a draft or scheduled newsletter |
| Admin: pages | `DELETE /api/v1/admin/cms/pages/{page_id}` | Delete a page |
| Admin: pages | `GET /api/v1/admin/cms/pages/{page_id}` | A page with its draft |
| Admin: pages | `GET /api/v1/admin/cms/pages` | Pages |
| Admin: pages | `POST /api/v1/admin/cms/pages/{page_id}/discard` | Discard draft changes (back to the published version) |
| Admin: pages | `POST /api/v1/admin/cms/pages/{page_id}/duplicate` | Copy a page as a new draft |
| Admin: pages | `POST /api/v1/admin/cms/pages/{page_id}/preview-token` | A short-lived link to preview the draft on the website |
| Admin: pages | `POST /api/v1/admin/cms/pages/{page_id}/publish` | Publish the draft now or at a scheduled time |
| Admin: pages | `POST /api/v1/admin/cms/pages/{page_id}/unpublish` | Take a page off the website (kept as a draft) |
| Admin: pages | `POST /api/v1/admin/cms/pages` | Create a page (as a draft) |
| Admin: pages | `PUT /api/v1/admin/cms/pages/{page_id}` | Save the draft (the published version is unchanged until you publish) |
| Admin: reports | `GET /api/v1/admin/reports/{key}/export` | Export a report as CSV, Excel or PDF |
| Admin: reports | `GET /api/v1/admin/reports/{key}` | Run a report |
| Admin: reports | `GET /api/v1/admin/reports` | Available reports |
| Admin: roles and permissions | `DELETE /api/v1/admin/roles/{role_id}` | Delete a custom role |
| Admin: roles and permissions | `GET /api/v1/admin/roles/catalogue` | All permissions grouped by module |
| Admin: roles and permissions | `GET /api/v1/admin/roles` | List roles |
| Admin: roles and permissions | `POST /api/v1/admin/roles` | Create a custom role |
| Admin: roles and permissions | `PUT /api/v1/admin/roles/{role_id}` | Update a role's name, description and permissions |
| Admin: scholarships | `DELETE /api/v1/admin/scholarships/{scholarship_id}` | Delete a scholarship without awards |
| Admin: scholarships | `GET /api/v1/admin/scholarships/export` | Export scholarship awards (CSV) |
| Admin: scholarships | `GET /api/v1/admin/scholarships/{scholarship_id}/awards` | Awards of a scholarship (private) |
| Admin: scholarships | `GET /api/v1/admin/scholarships` | All scholarships |
| Admin: scholarships | `POST /api/v1/admin/scholarships/{scholarship_id}/awards` | Record a scholarship award |
| Admin: scholarships | `POST /api/v1/admin/scholarships` | Create a scholarship |
| Admin: scholarships | `PUT /api/v1/admin/scholarships/{scholarship_id}` | Edit a scholarship |
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
| Admin: website | `DELETE /api/v1/admin/website/messages/{message_id}` | Delete a message |
| Admin: website | `GET /api/v1/admin/website/messages` | Messages from the website contact form |
| Admin: website | `GET /api/v1/admin/website/navigation` | Website menus |
| Admin: website | `PATCH /api/v1/admin/website/messages/{message_id}` | Mark a message read, replied or spam |
| Admin: website | `PUT /api/v1/admin/website/navigation/{key}` | Save a menu |
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
| Community | `DELETE /api/v1/community/comments/{comment_id}` | Delete a comment (yours, or any as a moderator) |
| Community | `DELETE /api/v1/community/posts/{post_id}/reaction` | Remove your reaction |
| Community | `DELETE /api/v1/community/posts/{post_id}` | Delete a post (yours, or any as a moderator) |
| Community | `GET /api/v1/community/feed` | Community feed (cursor pagination, newest first) |
| Community | `GET /api/v1/community/groups/{group_id}/members` | Group members (and join requests for its managers) |
| Community | `GET /api/v1/community/groups/{group_id}` | A group |
| Community | `GET /api/v1/community/groups` | Your groups, or groups to discover |
| Community | `GET /api/v1/community/posts/{post_id}/comments` | Comments of a post (oldest first, replies included) |
| Community | `GET /api/v1/community/posts/{post_id}/reactions` | Who reacted |
| Community | `GET /api/v1/community/posts/{post_id}` | One post |
| Community | `PATCH /api/v1/community/comments/{comment_id}` | Edit your comment |
| Community | `PATCH /api/v1/community/groups/{group_id}` | Edit a group (owners and moderators) |
| Community | `PATCH /api/v1/community/posts/{post_id}` | Edit your post |
| Community | `POST /api/v1/community/groups/{group_id}/join` | Join a group (or ask to join) |
| Community | `POST /api/v1/community/groups/{group_id}/leave` | Leave a group |
| Community | `POST /api/v1/community/groups/{group_id}/members/{user_id}` | Manage a member (owners and moderators) |
| Community | `POST /api/v1/community/groups` | Propose a group (moderators approve it) |
| Community | `POST /api/v1/community/posts/{post_id}/comments` | Comment on a post or reply to a comment |
| Community | `POST /api/v1/community/posts` | Create a post (text, images, share, announcement or forum topic) |
| Community | `POST /api/v1/community/reports` | Report a post or comment to the moderators |
| Community | `POST /api/v1/community/uploads` | Upload a photo for a post |
| Community | `PUT /api/v1/community/posts/{post_id}/reaction` | React to a post (replaces your previous reaction) |
| Custom fields | `GET /api/v1/custom-fields/{entity}/{record_id}/{key}/file` | Open a file attached to a custom field |
| Custom fields | `GET /api/v1/custom-fields/{entity}` | Active custom fields of a form |
| Custom fields | `POST /api/v1/custom-fields/files` | Upload a file for a file field (kept private) |
| Donations | `GET /api/v1/donations/campaigns/{campaign_id}` | A campaign with progress and donor recognition |
| Donations | `GET /api/v1/donations/campaigns` | Active fundraising campaigns |
| Donations | `GET /api/v1/donations/mine` | Your donation history |
| Donations | `GET /api/v1/donations/payment-info` | How to pay (bank transfer and other methods) |
| Donations | `GET /api/v1/donations/{donation_id}/receipt` | Printable receipt for a confirmed donation |
| Donations | `POST /api/v1/donations/pledges` | Pledge a donation (you then pay by bank transfer, cash or cheque) |
| Donations | `POST /api/v1/donations/{donation_id}/cancel` | Cancel a pledge you have not paid yet |
| Events | `GET /api/v1/events/{event_id}/calendar.ics` | Add to calendar (iCalendar file) |
| Events | `GET /api/v1/events/{event_id}` | Event details (meeting link for registered attendees) |
| Events | `GET /api/v1/events` | Events (upcoming, past or yours) |
| Events | `POST /api/v1/events/{event_id}/cancel` | Cancel your registration |
| Events | `POST /api/v1/events/{event_id}/register` | Register (joins the waitlist when the event is full) |
| Events | `PUT /api/v1/events/{event_id}/feedback` | Rate an event you attended |
| Gallery | `GET /api/v1/gallery/albums/{album_id}` | An album with its photos |
| Gallery | `GET /api/v1/gallery/albums` | Published albums |
| Health | `GET /api/v1/admin/health` | System health, queue backlog and recent API latency (p50/p95/p99) |
| Health | `GET /api/v1/health/live` | Liveness probe |
| Health | `GET /api/v1/health/ready` | Readiness probe (database + Redis) |
| Jobs | `DELETE /api/v1/jobs/resumes/{resume_id}` | Delete a CV |
| Jobs | `DELETE /api/v1/jobs/{job_id}/save` | Remove a saved job |
| Jobs | `GET /api/v1/jobs/applications/mine` | Your applications and their status |
| Jobs | `GET /api/v1/jobs/applications/{app_id}/resume` | Download the CV sent with an application |
| Jobs | `GET /api/v1/jobs/categories` | Job categories |
| Jobs | `GET /api/v1/jobs/employers/mine` | Organisations you registered |
| Jobs | `GET /api/v1/jobs/mine` | Jobs you posted |
| Jobs | `GET /api/v1/jobs/resources` | Career resources |
| Jobs | `GET /api/v1/jobs/resumes/mine` | Your CVs |
| Jobs | `GET /api/v1/jobs/resumes/{resume_id}/file` | Download your CV |
| Jobs | `GET /api/v1/jobs/{job_id}/applications` | Applications for a job you posted |
| Jobs | `GET /api/v1/jobs/{job_id}` | Job details |
| Jobs | `GET /api/v1/jobs` | Job and internship listings |
| Jobs | `PATCH /api/v1/jobs/applications/{app_id}` | Update an application's status (job poster or career office) |
| Jobs | `POST /api/v1/jobs/applications/{app_id}/withdraw` | Withdraw your application |
| Jobs | `POST /api/v1/jobs/employers` | Register your organisation as an employer (reviewed by the career office) |
| Jobs | `POST /api/v1/jobs/resumes` | Upload a CV (PDF or Word; private) |
| Jobs | `POST /api/v1/jobs/{job_id}/apply` | Apply through the portal |
| Jobs | `POST /api/v1/jobs/{job_id}/close` | Close a job to new applications |
| Jobs | `POST /api/v1/jobs` | Post a job (reviewed by the career office before it is listed) |
| Jobs | `PUT /api/v1/jobs/{job_id}/save` | Save a job |
| Jobs | `PUT /api/v1/jobs/{job_id}` | Edit your job (goes back to review) |
| Mentorship | `GET /api/v1/mentorship/me` | Your mentor profile (if any) and mentorship summary |
| Mentorship | `GET /api/v1/mentorship/mentors/{user_id}` | A mentor's profile |
| Mentorship | `GET /api/v1/mentorship/mentors` | Find a mentor (by industry, expertise, name) |
| Mentorship | `GET /api/v1/mentorship/requests/{request_id}` | One mentorship (sessions and feedback included) |
| Mentorship | `GET /api/v1/mentorship/requests` | Your mentorship requests (as mentor or mentee) |
| Mentorship | `PATCH /api/v1/mentorship/sessions/{session_id}` | Reschedule, cancel or record the outcome of a session |
| Mentorship | `POST /api/v1/mentorship/me/availability` | Pause or resume taking new mentees |
| Mentorship | `POST /api/v1/mentorship/requests/{request_id}/cancel` | Cancel your request (mentee) |
| Mentorship | `POST /api/v1/mentorship/requests/{request_id}/complete` | Mark a mentorship as completed |
| Mentorship | `POST /api/v1/mentorship/requests/{request_id}/respond` | Accept or decline a request (mentor) |
| Mentorship | `POST /api/v1/mentorship/requests/{request_id}/sessions` | Schedule a session |
| Mentorship | `POST /api/v1/mentorship/requests` | Ask a mentor for mentorship |
| Mentorship | `PUT /api/v1/mentorship/me` | Apply to become a mentor, or update your mentor profile |
| Mentorship | `PUT /api/v1/mentorship/requests/{request_id}/feedback` | Rate the mentorship |
| Messaging | `DELETE /api/v1/messages/blocks/{user_id}` | Unblock a member |
| Messaging | `DELETE /api/v1/messages/conversations/{conv_id}/members/{user_id}` | Leave a conversation, or remove a member (group admins) |
| Messaging | `DELETE /api/v1/messages/{message_id}/reactions/{emoji}` | Remove your reaction |
| Messaging | `DELETE /api/v1/messages/{message_id}` | Delete your message (for everyone) |
| Messaging | `GET /api/v1/messages/attachments/{media_id}` | Download an attachment (conversation members only) |
| Messaging | `GET /api/v1/messages/blocks` | Members you have blocked |
| Messaging | `GET /api/v1/messages/conversations/{conv_id}/messages` | Messages, newest page first (cursor `before`), oldest-first within a page |
| Messaging | `GET /api/v1/messages/conversations/{conv_id}` | One conversation |
| Messaging | `GET /api/v1/messages/conversations` | Your conversations (most recent first, with unread counts) |
| Messaging | `GET /api/v1/messages/presence` | Online status of members you share a conversation with |
| Messaging | `GET /api/v1/messages/unread` | Unread messages in total and per conversation |
| Messaging | `PATCH /api/v1/messages/conversations/{conv_id}` | Rename a group chat (group admins) |
| Messaging | `PATCH /api/v1/messages/{message_id}` | Edit your message |
| Messaging | `POST /api/v1/messages/conversations/direct` | Open (or create) the one-to-one chat with a member |
| Messaging | `POST /api/v1/messages/conversations/group` | Create a group chat |
| Messaging | `POST /api/v1/messages/conversations/{conv_id}/delivered` | Acknowledge delivery (up to message_id) |
| Messaging | `POST /api/v1/messages/conversations/{conv_id}/members` | Add members to a group chat (group admins) |
| Messaging | `POST /api/v1/messages/conversations/{conv_id}/messages` | Send a message (idempotent with client_id) |
| Messaging | `POST /api/v1/messages/conversations/{conv_id}/read` | Mark messages as read (up to message_id, default: all) |
| Messaging | `POST /api/v1/messages/uploads` | Upload an attachment (image or document; private) |
| Messaging | `PUT /api/v1/messages/blocks/{user_id}` | Block a member (they can no longer message you) |
| Messaging | `PUT /api/v1/messages/conversations/{conv_id}/settings` | Mute, archive or pin a conversation (for you) |
| Messaging | `PUT /api/v1/messages/{message_id}/reactions/{emoji}` | React to a message |
| News | `GET /api/v1/news/{slug}` | An article |
| News | `GET /api/v1/news` | News and announcements (includes members-only posts) |
| Newsletter | `GET /api/v1/newsletter/me` | Your newsletter subscription |
| Newsletter | `PUT /api/v1/newsletter/me` | Subscribe or unsubscribe |
| Notifications | `DELETE /api/v1/notifications/{notification_id}` | Delete a notification |
| Notifications | `GET /api/v1/notifications/preferences` | Your notification preferences |
| Notifications | `GET /api/v1/notifications/unread-count` | Number of unread notifications |
| Notifications | `GET /api/v1/notifications` | Your notifications (newest first) |
| Notifications | `POST /api/v1/notifications/read-all` | Mark all as read |
| Notifications | `POST /api/v1/notifications/{notification_id}/read` | Mark one notification as read |
| Notifications | `PUT /api/v1/notifications/preferences` | Update your notification preferences |
| Public | `GET /api/v1/public/achievements` | Published achievements the members agreed to show publicly |
| Public | `GET /api/v1/public/campaigns` | Active campaigns for the public website |
| Public | `GET /api/v1/public/custom-fields/registration` | Extra questions asked on the registration form |
| Public | `GET /api/v1/public/events/{event_id}` | An upcoming event (registration happens in the portal) |
| Public | `GET /api/v1/public/events` | Upcoming events for the website |
| Public | `GET /api/v1/public/gallery/{album_id}` | A public album |
| Public | `GET /api/v1/public/gallery` | Public albums for the website |
| Public | `GET /api/v1/public/home` | The website home page (null = the built-in landing page) |
| Public | `GET /api/v1/public/i18n/{code}` | Interface strings for a language |
| Public | `GET /api/v1/public/languages` | Languages offered in the interface |
| Public | `GET /api/v1/public/news/{slug}` | A published article |
| Public | `GET /api/v1/public/news` | Published news for the website |
| Public | `GET /api/v1/public/pages/{slug}` | A published page, ready to render |
| Public | `GET /api/v1/public/preview` | Preview a draft with a link from the page editor |
| Public | `GET /api/v1/public/site` | Site identity, published branding, enabled modules |
| Public | `GET /api/v1/public/sitemap` | Published pages and news for the sitemap |
| Public | `GET /api/v1/public/stats` | Headline figures for the website |
| Public | `GET /api/v1/public/website` | Menus, footer and contact details for the website |
| Public | `POST /api/v1/public/contact` | Send a message to the alumni office |
| Public | `POST /api/v1/public/newsletter/confirm` | Confirm a subscription |
| Public | `POST /api/v1/public/newsletter/subscribe` | Subscribe to the newsletter (a confirmation email is sent) |
| Public | `POST /api/v1/public/newsletter/unsubscribe` | Unsubscribe (one click from any newsletter) |
| Registration | `GET /api/v1/public/batches` | Active batches (for registration and filters) |
| Registration | `POST /api/v1/auth/register` | Register as an alumnus or current student |
| Scholarships | `GET /api/v1/scholarships` | Scholarship funds |
| Setup wizard | `GET /api/v1/setup/status` | Is installation required? Includes environment checks. |
| Setup wizard | `POST /api/v1/setup/complete` | Finish installation: settings + first administrator |
| Setup wizard | `POST /api/v1/setup/test-email` | Test SMTP settings before saving |
| Setup wizard | `POST /api/v1/setup/test-storage` | Test storage settings before saving |
| Setup wizard | `POST /api/v1/setup/upload` | Upload a logo or image during setup |
| Setup wizard | `POST /api/v1/setup/verify-code` | Check the setup code |
