#!/usr/bin/env bash
set -euo pipefail
umask 077
# shellcheck source=var/docker/server/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
[[ $# -ge 2 && $# -le 3 ]] || die 'Usage: backup.sh ENV_FILE BACKUP_ROOT [--leave-stopped]'
leave_stopped=false
if [[ $# -eq 3 ]]; then
    [[ $3 == --leave-stopped ]] || die 'Unknown backup option.'
    leave_stopped=true
fi
init_stack "$1"
backup_root=$(realpath -m "$2")
[[ $backup_root != "$stack_root/"* ]] || die 'Backups must live outside the repository.'
install -d -m 0700 "$backup_root"
exec 9> "$backup_root/.backup.lock"
flock -n 9 || die 'Another backup is running.'
snapshot="$backup_root/$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 0700 "$snapshot"
running=()
running_text=$(dc ps --services --status running)
if [[ -n $running_text ]]; then mapfile -t running <<< "$running_text"; fi
resume() {
    local status=$?
    trap - EXIT
    if [[ $leave_stopped == false && ${#running[@]} -gt 0 ]]; then
        dc start "${running[@]}" || status=1
    fi
    if [[ $status -ne 0 ]]; then
        echo 'Backup failed. Inspect private backup logs and service state; do not use an incomplete snapshot.' >&2
    fi
    exit "$status"
}
trap resume EXIT
for service in postiz-postgres temporal-postgresql; do
    [[ $(docker inspect --format '{{.State.Running}}' "$(container "$service")") == true ]] || die 'Both database containers must be running.'
done
docker image inspect "$helper_image" >/dev/null
stop_writers
echo 'Publishers, Temporal, Elasticsearch, and Redis stopped for a consistent backup.'
dc exec -T postiz-postgres pg_dump -U postiz-user -d postiz-db-local -Fc </dev/null > "$snapshot/studio.dump" 2> "$snapshot/database.log"
# Include every Temporal database, including SQL visibility if it exists.
dc exec -T temporal-postgresql psql -U temporal -d postgres -At -v ON_ERROR_STOP=1 \
    -c "SELECT datname FROM pg_database WHERE NOT datistemplate AND datname <> 'postgres' ORDER BY datname" \
    </dev/null > "$snapshot/temporal-databases" 2>> "$snapshot/database.log"
grep -qx temporal "$snapshot/temporal-databases" || die 'Temporal history database missing.'
while IFS= read -r database; do
    [[ $database =~ ^[a-zA-Z0-9_]+$ ]] || die 'Unexpected Temporal database name.'
    dc exec -T temporal-postgresql pg_dump -U temporal -d "$database" -Fc \
        </dev/null > "$snapshot/temporal-$database.dump" 2>> "$snapshot/database.log"
done < "$snapshot/temporal-databases"
archive_volume postiz /uploads "$snapshot/uploads.tar.gz"
archive_volume postiz /config "$snapshot/config.tar.gz"
archive_volume temporal-elasticsearch /usr/share/elasticsearch/data "$snapshot/elasticsearch.tar.gz"
archive_volume postiz-redis /data "$snapshot/redis.tar.gz"
docker inspect --format '{{.Config.Image}}' "$(container temporal-elasticsearch)" > "$snapshot/elasticsearch-image-reference"
(
    cd "$snapshot"
    sha256sum ./*.dump ./*.tar.gz temporal-databases elasticsearch-image-reference > SHA256SUMS
)
touch "$snapshot/COMPLETE"
find "$snapshot" -type f -exec chmod 0600 {} +
# Remove only complete snapshots produced by this script, after a successful backup.
if [[ ${KIT_MODE:-server} == server ]]; then
    old_snapshots=$(find "$backup_root" -mindepth 1 -maxdepth 1 -type d -mtime +13)
    while IFS= read -r old; do
        if [[ -f $old/COMPLETE && $(basename "$old") =~ ^[0-9]{8}T[0-9]{6}Z$ ]]; then
            rm -rf -- "$old"
        fi
    done <<< "$old_snapshots"
fi
printf 'Backup complete: %s\n' "$snapshot"
