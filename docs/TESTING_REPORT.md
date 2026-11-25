# Testing report

Date: 2026-11-25 · Build: Stages 1–6 · Environment: development PC (Windows 10, Python 3.12.8, PostgreSQL 17,
in-memory Redis, Node 22). Docker-based validation is listed under §5 and is run on the target server.

## 1. Automated backend tests — 51 passed
`cd backend && uv run pytest` (fresh schema each run, all migrations applied, bootstrap run).

| Area | Tests | What is covered |
|---|---|---|
| Setup & auth | 7 | setup wizard, login errors and lockout, refresh rotation and reuse detection, password reset, 2FA, session revocation on password change, forged tokens |
| Administration (Stage 1) | 8 | RBAC on the backend, role-escalation block, last Super Admin, settings validation + audit, branding publish, modules / flags, secrets never returned, upload validation, health |
| Alumni core | 7 | registration validation and no account discovery, verification, privacy levels, directory, connections, batches, records, dashboard |
| Community & messaging | 3 | posts / comments / reactions / moderation, groups, conversations, idempotent send, receipts |
| Engagement | 4 | events + waitlist + check-in, jobs + applications, mentorship, achievements and consent |
| Institutional | 6 | notifications and preferences, donations pledge → receipt → refund, scholarships, newsletters, gallery |
| Administration (Stage 5) | 7 | CMS pages / preview / schedule / link safety, news, navigation, contact form, custom fields (validation, conditions, visibility, private files), localisation, 13 reports + CSV / Excel / PDF, translation-key sync |
| Security (Stage 6) | 7 | see §2 |

Lint (`ruff`) clean; TypeScript strict type-check clean for the portal/admin app and the website.

## 2. Security testing
| Requirement | Evidence |
|---|---|
| Access control on every endpoint | `test_every_admin_endpoint_rejects_members` calls **every** `/api/v1/admin/*` route with every method as a member → all 401/403. `test_every_private_endpoint_requires_sign_in` calls every non-public route anonymously → 401/403 |
| Object-level access | other members' donations, receipts, cancellation, conversations and private documents → 403/404 |
| SQL injection | classic payloads in every search box (directory, users, audit, news, jobs) → handled normally; the users table intact; no hashes in any response (all queries parameterised via SQLAlchemy) |
| XSS | rich text (pages, news, newsletters) escaped first, then a small syntax applied; `<script>` rendered as text (unit test + browser test); link fields accept only paths, https, mailto, tel |
| CSRF | refresh cookie `HttpOnly; SameSite=Strict; Secure` over HTTPS; API uses bearer tokens; cookie endpoints reject foreign `Origin` (test) |
| Rate limiting | login lockout, registration, contact form (429 after 5 / hour), newsletter, pledges, data export |
| Headers | `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, CSP on the app, HSTS on the TLS edge |
| Uploads | content sniffing (not the extension), allowed types, size limit, metadata stripped, private files never public |
| Secrets | integration credentials encrypted at rest and masked in the API (test) |
| Sessions | rotation, reuse detection, sign-out everywhere, revoked on password change and account deletion |
| Privacy | data export excludes password and token hashes; deletion anonymises and signs out everywhere (test) |
| Audit | approvals, exports, settings, deletions, publishing all written to the audit log |

## 3. Functional testing (browser, Playwright)
| Walk-through | Result |
|---|---|
| Stage 1 — wizard, 12 admin screens, users, branding, sign-in rules, mobile | pass |
| Stage 2 — registration, verification, profile & privacy, directory, connections, mobile | pass |
| Stage 3 — feed, groups, chat, events + QR check-in, jobs, mentorship, achievements, mobile | pass |
| Stage 4 — pledge → confirm → receipt, notifications, newsletter, gallery, mobile | pass |
| Stage 5 — page builder + preview + publish, menus, news, contact inbox, custom field, Urdu RTL, reports + exports, website and admin at 390 px | pass, no page errors |
| Stage 6 — download my data, deletion request, administrator approval, signed-out account, mobile | pass, no page errors |
Scripts: `frontend/app/scripts/e2e-stage*.mjs`.

## 4. Performance
Sequential service time on the development PC (single API process, warm caches, 100 requests each):

| Endpoint | p50 ms | p95 ms |
|---|---|---|
| public site settings | 4 | 8 |
| /auth/me | 11 | 17 |
| member dashboard (≈14 widgets) | 34 | 94 |
| directory search | 14 | 21 |
| community feed | 14 | 20 |
| events / jobs / notifications | 8–12 | 12–28 |
| website page / news / menus | 5–8 | 11–16 |
| registration report | 7 | 9 |

With 20 concurrent clients on the same PC the numbers are dominated by the load generator and the single process
(p95 250–1200 ms); this is not representative. The acceptance test is `make loadtest` on the server (k6 inside Docker,
200 virtual users, fails when any tracked endpoint's p95 exceeds 200 ms). Production sizing runs several API
replicas behind nginx.

## 5. Docker deployment validation (run on the server)
```
make install                 # build, start, print the setup code
make health                  # all checks green
make loadtest email=<admin> password=<password>   # p95 < 200 ms
make backup && make restore b=backups/<timestamp> # restore test
make up-https                # with certificates in certs/
```
Record the results of these commands here after the first installation.

## 6. Known limitations
- Real-time push across processes (API → Redis → gateway → browser) was verified with the in-memory Redis only
  within one process; run `LIVE=1 node scripts/e2e-stage3-community.mjs …` against the Docker stack to confirm.
- Online payment gateways are intentionally disabled (pledge + offline payment only).
- PDF exports use the built-in Helvetica font; Urdu text in free-text cells is replaced (reports are aggregates).
