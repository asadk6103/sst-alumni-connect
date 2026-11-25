# Production deployment checklist

## Server
- [ ] Linux server with Docker Engine 24+ and Compose v2.24+, 4 vCPU / 8 GB RAM minimum, SSD.
- [ ] Firewall: only 80 and 443 open (and SSH from known addresses). PostgreSQL, Redis and MinIO are never exposed.
- [ ] Time synchronised (NTP); timezone does not matter (the app stores UTC).
- [ ] Automatic security updates for the OS.

## Install
- [ ] `make install` → note the setup code → complete the setup wizard in the browser.
- [ ] No `.env` secrets edited by hand: infrastructure passwords and keys are generated on first start.
- [ ] `make health` all green.

## HTTPS
- [ ] DNS A record points to the server.
- [ ] Certificates in `certs/fullchain.pem` and `certs/privkey.pem` (see DEPLOYMENT.md → HTTPS), renewal scheduled.
- [ ] `make up-https`; `http://` redirects to `https://`; HSTS header present.
- [ ] System Configuration → General → Application URL is the `https://` address.

## Configuration
- [ ] Email (SMTP) tested; SPF / DKIM set for the sending domain.
- [ ] SMS provider tested (if mobile verification is used).
- [ ] Security: minimum password length ≥ 10, lockout on, 2FA required for staff.
- [ ] Allowed file types and maximum upload size reviewed.
- [ ] Branding published; website home page and menus reviewed; About and Contact pages published.
- [ ] Donation bank details entered and checked by finance.
- [ ] Modules not in use switched off.

## People and access
- [ ] At most two Super Administrators; everyone else on the narrowest role.
- [ ] Every staff account has 2FA enabled.
- [ ] Test accounts removed.

## Data protection
- [ ] Daily backup cron installed; first backup copied offsite, encrypted (BACKUP_RESTORE.md).
- [ ] Restore tested on a separate machine.
- [ ] Privacy policy / terms URL set (System Configuration → Alumni & registration).
- [ ] Owner named for Privacy Requests and for the audit log review (monthly).

## Performance and monitoring
- [ ] `make up-prod` sizing (API and real-time replicas) matches expected users.
- [ ] `make loadtest` passes (p95 < 200 ms).
- [ ] System Health checked after the first week (failed deliveries, queue backlog, p95).
- [ ] Log rotation active (configured in Compose); disk usage alert at 80 %.

## Go-live
- [ ] School records imported so registrations match automatically.
- [ ] Announcement newsletter prepared; website links shared.
- [ ] Rollback plan: `make backup` immediately before every `make upgrade`.
