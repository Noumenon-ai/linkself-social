#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=var/docker/server/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
[[ $# -ge 2 ]] || die 'Usage: dc.sh ENV_FILE <compose arguments>'
init_stack "$1"
shift
dc "$@"
