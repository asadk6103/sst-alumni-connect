# Backup and restoration guide

## What a backup contains
`make backup` (or `./infrastructure/scripts/backup.sh`) writes `backups/<timestamp>/`:

| File | Contents |
|---|---|
| `database.dump` | PostgreSQL custom-format dump: every table, including users, profiles, messages, donations, settings, audit log |
| `storage.tar.gz` | uploaded files on the local storage volume (photos, documents, CVs, gallery) |
| `objects.tar.gz` | the bundled MinIO object store (when used) |
| `app-config.tar.gz` | generated application keys — **required** to decrypt stored SMTP / SMS / storage credentials and 2FA secrets |
| `SHA256SUMS` | checksums verified before any restore |

Options: `--db-only` (database only, fast), `--keep N` (number of backups kept, default 14).

## Protecting backups
Backups hold personal data and encryption keys.
- The `backups/` folder is created with `chmod 700`; keep it that way.
- Copy each backup **off the server**, encrypted. Example with `age`:
  `tar c backups/20261125-020000 | age -r <public-key> > alumni-20261125.tar.age`
- Keep at least one copy in a different location from the server (offsite / cloud bucket with versioning).
- Restrict who can read the offsite copies; log access.

## Schedule
Add to the server's crontab (as the user that runs Docker):
```
# daily at 02:00, keep 14 days; weekly full copy offsite (your own command)
0 2 * * *  cd /opt/sst-alumni-connect && ./infrastructure/scripts/backup.sh --keep 14 >> backups/backup.log 2>&1
```
Recommended: daily full backups, plus `--db-only` every 4 hours on busy days (reunions, donation drives).

## Restoring
1. Pick the backup: `ls backups/`.
2. `make restore b=backups/20261125-020000` (asks you to type `RESTORE`; add `--yes` in scripts).
3. The script verifies checksums, stops application services, restores the database (and files and keys when present),
   applies any newer migrations and starts the stack again.
4. Check: `make health`, sign in as an administrator, open System Health, and spot-check a profile photo and a CV.

## Restore to a new server (disaster recovery)
1. Install Docker and copy the project folder (or clone it) to the new server.
2. Copy the backup folder into `backups/`.
3. `make install` once (creates volumes), then `make restore b=backups/<timestamp> --yes`.
4. Point DNS to the new server; put the TLS certificates in `certs/` and run `make up-https`.

## Test your backups
At least once per quarter, restore the latest backup to a separate machine (or a copy of the stack with a different
`COMPOSE_PROJECT_NAME`) and sign in. A backup that has never been restored is not a backup.
