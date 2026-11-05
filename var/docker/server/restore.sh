#!/usr/bin/env bash
set -euo pipefail
umask 077
# shellcheck source=var/docker/server/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
[[ $# -ge 3 && $# -le 4 && $1 == --apply ]] || die 'Usage: restore.sh --apply ENV_FILE SNAPSHOT [--replace]'
replace=false
if [[ $# -eq 4 ]]; then
    [[ $4 == --replace ]] || die 'Unknown restore option.'
    replace=true
fi
init_stack "$2"
snapshot=$(realpath "$3")
[[ -f $snapshot/COMPLETE ]] || die 'Snapshot is incomplete.'
[[ -z $(dc ps --quiet --status running) ]] || die 'Stop the entire destination stack before restoring.'
(
    cd "$snapshot"
    sha256sum --check --status SHA256SUMS
) || die 'Snapshot checksum verification failed.'
target_es=$(dc config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["services"]["temporal-elasticsearch"]["image"])')
[[ $target_es == "$(cat "$snapshot/elasticsearch-image-reference")" ]] || die 'Elasticsearch image reference must exactly match the snapshot.'
if [[ $replace == false ]]; then
    [[ -z $(dc ps --all --quiet) ]] || die 'Fresh restore requires an unused destination project. Use --replace only for an intentional recovery.'
    project=$(dc config --format json | python3 -c 'import json,sys; print(json.load(sys.stdin)["name"])')
    [[ -z $(docker volume ls -q --filter "label=com.docker.compose.project=$project") ]] || die 'Destination project has existing volumes; fresh restore refused.'
fi
dc create --pull never
restore_volume postiz /uploads "$snapshot/uploads.tar.gz"
restore_volume postiz /config "$snapshot/config.tar.gz"
restore_volume temporal-elasticsearch /usr/share/elasticsearch/data "$snapshot/elasticsearch.tar.gz"
restore_volume postiz-redis /data "$snapshot/redis.tar.gz"
dc up -d --no-deps --pull never postiz-postgres temporal-postgresql
wait_database postiz-postgres postiz-user postiz-db-local
wait_database temporal-postgresql temporal postgres
dc exec -T postiz-postgres pg_restore -U postiz-user -d postgres \
    --clean --if-exists --create --exit-on-error --no-owner --no-acl \
    < "$snapshot/studio.dump" > "$snapshot/restore.log" 2>&1
while IFS= read -r database; do
    [[ $database =~ ^[a-zA-Z0-9_]+$ ]] || die 'Unexpected Temporal database name.'
    dc exec -T temporal-postgresql pg_restore -U temporal -d postgres \
        --clean --if-exists --create --exit-on-error --no-owner --no-acl \
        < "$snapshot/temporal-$database.dump" >> "$snapshot/restore.log" 2>&1
done < "$snapshot/temporal-databases"
chmod 0600 "$snapshot/restore.log"
echo 'Restore complete. Only the two database services are running. Start Temporal before the studio.'
