#!/bin/sh
# Generates infrastructure passwords once (database, Redis, object storage, Flower) into a private
# volume shared with the services that need them. Nothing secret lives in .env or in Git.
set -eu
DIR=/run/infra
mkdir -p "$DIR"
gen() {  # gen NAME LENGTH
  if [ ! -s "$DIR/$1" ]; then
    tr -dc 'A-Za-z0-9' </dev/urandom | head -c "$2" > "$DIR/$1"
    echo "[init-secrets] generated $1"
  fi
}
gen postgres_password 40
gen redis_password 40
gen minio_user 20
gen minio_password 40
gen flower_password 24
# Readable by the service users (postgres uid 70, app uid 10001, redis 999, minio root) but not world-writable.
chmod 0444 "$DIR"/*
echo "[init-secrets] ready"
