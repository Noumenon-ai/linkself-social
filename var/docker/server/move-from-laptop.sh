#!/usr/bin/env bash
set -euo pipefail
umask 077
# shellcheck source=var/docker/server/common.sh
source "$(dirname -- "${BASH_SOURCE[0]}")/common.sh"
apply=false
STUDIO_IMAGE=${STUDIO_IMAGE:-}
while [[ $# -gt 0 && $1 == --* ]]; do
    case $1 in
        --dry-run) apply=false; shift ;;
        --apply) apply=true; shift ;;
        --image) [[ $# -ge 2 ]] || die 'Missing image tag.'; STUDIO_IMAGE=$2; shift 2 ;;
        *) die 'Unknown option.' ;;
    esac
done
[[ $# -eq 3 ]] || die 'Usage: move-from-laptop.sh [--dry-run|--apply] --image TAG SSH_TARGET ORIGIN_HOST ENV_FILE'
target=$1
STUDIO_ORIGIN_HOST=$2
[[ $target =~ ^[a-z_][a-z0-9_-]*@[a-zA-Z0-9][a-zA-Z0-9.-]*$ ]] || die 'Use an admin@host SSH target without shell metacharacters.'
[[ $STUDIO_ORIGIN_HOST =~ ^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$ ]] || die 'Origin must be a DNS hostname, without a scheme or path.'
[[ $STUDIO_ORIGIN_HOST != linkself.net ]] || die 'Use a separate origin hostname.'
[[ $STUDIO_IMAGE =~ ^[a-zA-Z0-9][a-zA-Z0-9._/:-]*:[a-zA-Z0-9._-]+$ ]] || die 'Supply an explicit image tag.'
export STUDIO_IMAGE STUDIO_ORIGIN_HOST
export KIT_MODE=laptop
init_stack "$3"
ssh_cmd=(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 "$target")
for command in docker ssh tar curl python3 sha256sum flock getent; do
    command -v "$command" >/dev/null || die "Required command missing: $command."
done
[[ $(docker inspect --format '{{.State.Running}}' "$(container postiz)") == true ]] || die 'Laptop studio is not running; inspect an earlier cutover before proceeding.'
# The server runs an image built for the final address, which differs from the laptop's.
[[ $(docker image inspect --format '{{range .Config.Env}}{{println .}}{{end}}' "$STUDIO_IMAGE" | grep -c '^LINKSELF_BASE_PATH=/dashboard/studio$') -eq 1 ]] || die 'The studio image was not built with LINKSELF_BASE_PATH=/dashboard/studio.'
# Validate the destination model using the supplied env, without displaying it.
server_compose=(docker compose --project-directory "$stack_root" --env-file "$LINKSELF_SOCIAL_ENV" -p linkself-server
    -f "$stack_root/docker-compose.linkself.yaml" -f "$stack_root/docker-compose.linkself.local.yaml" -f "$kit_dir/docker-compose.server.yaml")
"${server_compose[@]}" config --quiet 2>/dev/null || die 'Destination env is incomplete or invalid.'
images_text=$("${server_compose[@]}" config --images)
mapfile -t images <<< "$images_text"
for image in "${images[@]}"; do docker image inspect "$image" >/dev/null; done
# Every service holding data must use the same image on both sides of this move.
model=$("${server_compose[@]}" config --format json | python3 -c 'import json,sys; print("\n".join(k+" "+v["image"] for k,v in json.load(sys.stdin)["services"].items() if k not in ("caddy", "postiz")))')
while read -r service image; do
    [[ $(docker image inspect --format '{{.Id}}' "$image") == "$(docker inspect --format '{{.Image}}' "$(container "$service")")" ]] || die "Image mismatch for $service; stage the running image first."
done <<< "$model"
for service in postiz-postgres temporal-postgresql; do
    [[ $(docker inspect --format '{{.State.Running}}' "$(container "$service")") == true ]] || die 'Database is not running.'
done
getent ahostsv4 "$STUDIO_ORIGIN_HOST" >/dev/null || die 'Origin DNS does not resolve.'
# Prove that origin DNS reaches the SSH destination before requesting a certificate.
"${ssh_cmd[@]}" true
remote_id=$("${ssh_cmd[@]}" docker info --format '{{.ID}}')
origin_id=$(ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 \
    "${target%@*}@$STUDIO_ORIGIN_HOST" docker info --format '{{.ID}}')
[[ -n $remote_id && $remote_id == "$origin_id" ]] || die 'Origin DNS and the SSH target do not reach the same Docker server.'
local_arch=$(docker info --format '{{.Architecture}}')
remote_arch=$("${ssh_cmd[@]}" docker info --format '{{.Architecture}}')
[[ $local_arch == "$remote_arch" ]] || die 'Laptop Docker and server architectures differ; use a matching platform image and transfer procedure.'
"${ssh_cmd[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
test -w /srv/linkself-social
test -w /srv/linkself-social-private
test ! -e /srv/linkself-social-private/migration-started
test ! -e /srv/linkself-social-private/studio.env
test -z "$(docker ps -aq --filter label=com.docker.compose.project=linkself-server)"
test -z "$(docker volume ls -q --filter label=com.docker.compose.project=linkself-server)"
version=$(docker compose version --short)
test "$(printf '%s\n' 2.24.4 "${version#v}" | sort -V | head -n1)" = 2.24.4
for command in python3 curl sha256sum flock; do command -v "$command" >/dev/null; done
# Both ports must be available for Caddy, including its initial ACME challenge.
test -z "$(ss -H -ltn 'sport = :80 or sport = :443')"
echo 'Server Docker, private directories, fresh destination, and free TLS ports checked.'
REMOTE
echo 'Plan: transfer all staged images and deployment files; copy the private env; stop laptop publishers; take a complete snapshot; restore; start the server; check HTTPS health.'
echo 'The source databases and volumes will remain in place. Source backups will not be pruned.'
echo 'Before --apply, confirm the same server SSH host key for the target and origin hostname, and allow public inbound TCP 80 and 443 at the provider firewall.'
if [[ $apply == false ]]; then
    echo 'Dry run complete. No files, containers, or env values were changed.'
    exit 0
fi

[[ -n ${MIGRATION_BACKUP_ROOT:-} ]] || die 'Set MIGRATION_BACKUP_ROOT to a private directory outside the repository.'
backup_root=$MIGRATION_BACKUP_ROOT
backup_root=$(realpath -m "$backup_root")
[[ $backup_root != "$stack_root/"* && $backup_root != "$stack_root" ]] || die 'Migration backups must be outside the repository.'
install -d -m 0700 "$backup_root"
exec 8> "$backup_root/.migration.lock"
flock -n 8 || die 'Another migration is running.'
failed() {
    echo 'Cutover stopped on failure. The laptop data is retained. Do not start its worker until the server is stopped and rollback state is reconciled; follow README.md.' >&2
}
trap failed ERR
"${ssh_cmd[@]}" 'umask 077; touch /srv/linkself-social-private/migration-started'
echo 'Transferring all staged images, including the studio image. No image pulls will be made.'
docker save "${images[@]}" | "${ssh_cmd[@]}" docker load > /dev/null
tar -C "$stack_root" -czf - docker-compose.linkself.yaml docker-compose.linkself.local.yaml \
    dynamicconfig var/docker/server | "${ssh_cmd[@]}" 'tar -xzf - -C /srv/linkself-social'
"${ssh_cmd[@]}" 'umask 077; cat > /srv/linkself-social-private/studio.env; chmod 600 /srv/linkself-social-private/studio.env' < "$LINKSELF_SOCIAL_ENV"
# The supplied arguments are validated above and stored in the private dotenv file.
printf '\nSTUDIO_ORIGIN_HOST=%s\nSTUDIO_IMAGE=%s\n' "$STUDIO_ORIGIN_HOST" "$STUDIO_IMAGE" |
    "${ssh_cmd[@]}" 'cat >> /srv/linkself-social-private/studio.env'
"${ssh_cmd[@]}" 'cd /srv/linkself-social; bash -c '\''source var/docker/server/common.sh; init_stack /srv/linkself-social-private/studio.env; dc config --quiet'\''' >/dev/null
echo 'Images, stack files, and private env transferred and validated.'
cutover_root="$backup_root/cutover-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -m 0700 "$cutover_root"
bash "$kit_dir/backup.sh" "$LINKSELF_SOCIAL_ENV" "$cutover_root" --leave-stopped
snapshot=$(find "$cutover_root" -mindepth 2 -maxdepth 2 -name COMPLETE -printf '%h\n')
[[ -n $snapshot ]] || die 'No complete migration snapshot found.'
"${ssh_cmd[@]}" 'umask 077; mkdir -m 700 /srv/linkself-social-private/migration'
tar -C "$snapshot" -czf - . | "${ssh_cmd[@]}" 'tar -xzf - -C /srv/linkself-social-private/migration'
"${ssh_cmd[@]}" 'bash /srv/linkself-social/var/docker/server/restore.sh --apply /srv/linkself-social-private/studio.env /srv/linkself-social-private/migration'
"${ssh_cmd[@]}" 'bash -s' <<'REMOTE'
set -euo pipefail
source /srv/linkself-social/var/docker/server/common.sh
init_stack /srv/linkself-social-private/studio.env
dc up -d --pull never temporal-elasticsearch postiz-redis temporal temporal-ui
ready=false
for ((attempt=0; attempt<90; attempt++)); do
    if dc exec -T temporal temporal operator cluster health --address temporal:7233 >/dev/null 2>&1; then ready=true; break; fi
    sleep 2
done
[[ $ready == true ]] || die 'Temporal readiness timed out; studio has not been started.'
dc up -d --pull never postiz caddy
REMOTE
healthy=false
for ((attempt=0; attempt<90; attempt++)); do
    if curl --fail --silent --show-error --connect-timeout 5 --max-time 10 \
        "https://$STUDIO_ORIGIN_HOST/dashboard/studio/api/auth/can-register" >/dev/null 2>&1; then
        healthy=true
        break
    fi
    sleep 5
done
[[ $healthy == true ]] || die 'Origin HTTPS health timed out. Inspect Caddy DNS/TLS and studio logs; keep the laptop worker stopped.'
printf 'Manual upload rewrite commands (replace the old origin, then inspect the dry-run counts):\nssh %s\n' "$target"
printf '%s\n' 'cd /srv/linkself-social' 'source var/docker/server/common.sh' \
    'init_stack /srv/linkself-social-private/studio.env' \
    'OLD_UPLOAD_ORIGIN="https://<old-upload-host>"'
printf 'dc exec -T postiz pnpm uploads:rewrite-origin --from="$OLD_UPLOAD_ORIGIN" --to=https://linkself.net/dashboard/studio\n'
printf 'dc exec -T postiz pnpm uploads:rewrite-origin --from="$OLD_UPLOAD_ORIGIN" --to=https://linkself.net/dashboard/studio --apply\n'
printf 'Manual LinkSelf production setting: SOCIAL_ORIGIN_URL=https://%s\n' "$STUDIO_ORIGIN_HOST"
cat <<'NEXT'
Origin HTTPS health passed. The server worker is now active; the laptop worker is stopped.
Next manual steps (not executed):
1. Follow README.md to rewrite old upload origins on the server: dry run, inspect counts, then --apply.
2. Set SOCIAL_ORIGIN_URL=https://<origin-host> in LinkSelf production and redeploy its Vercel rewrite.
3. Update provider redirect URIs to the browser-facing https://linkself.net/dashboard/studio paths listed by each provider setup screen.
4. Verify login, uploads, a scheduled test post, and the browser route. Then stop the old tunnel.
Rollback within the hour: first stop the server publishers. If they have run, take a new complete server backup and restore it to the stopped laptop before starting its worker. See README.md; never run both workers.
NEXT
