#!/usr/bin/env bash
# Kept for compatibility: the installers now live in install/ (see install/README.md).
exec "$(cd "$(dirname "$0")/../.." && pwd)/install/install-docker.sh" "$@"
