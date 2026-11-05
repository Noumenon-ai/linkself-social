#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=var/docker/server/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
[[ $# -eq 1 ]] || die 'Usage: start-after-restore.sh ENV_FILE'
init_stack "$1"
dc up -d --pull never temporal-elasticsearch postiz-redis temporal temporal-ui
ready=false
for ((attempt=0; attempt<90; attempt++)); do
    if dc exec -T temporal temporal operator cluster health --address temporal:7233 </dev/null >/dev/null 2>&1; then ready=true; break; fi
    sleep 2
done
[[ $ready == true ]] || die 'Temporal readiness timed out; studio has not been started.'
dc up -d --pull never postiz caddy
