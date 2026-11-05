#!/usr/bin/env bash
# Shared functions; do not execute this file directly.
set -euo pipefail
umask 077
kit_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
stack_root=$(cd -- "$kit_dir/../../.." && pwd)
helper_image=postgres:17-alpine
replace=false

die() { printf '%s\n' "$*" >&2; exit 1; }

init_stack() {
    [[ $# -eq 1 && -f $1 ]] || die 'A private env file is required.'
    LINKSELF_SOCIAL_ENV=$(realpath "$1")
    export LINKSELF_SOCIAL_ENV
    [[ $(stat -c %a "$LINKSELF_SOCIAL_ENV") == 600 ]] || die 'Env file must have mode 600.'
    [[ $LINKSELF_SOCIAL_ENV != "$stack_root/"* ]] || die 'Keep the env file outside the repository.'
    local version
    version=$(docker compose version --short)
    version=${version#v}
    [[ $(printf '%s\n' 2.24.4 "$version" | sort -V | head -n1) == 2.24.4 ]] || die 'Docker Compose 2.24.4 or newer is required.'
    compose=(docker compose --project-directory "$stack_root" --env-file "$LINKSELF_SOCIAL_ENV")
    if [[ ${KIT_MODE:-server} == laptop ]]; then
        local project
        project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' linkself-social)
        [[ $project =~ ^[a-z0-9][a-z0-9_-]*$ ]] || die 'Cannot identify the laptop Compose project.'
        compose+=(-p "$project")
    elif [[ ${KIT_MODE:-server} == server ]]; then
        compose+=(-p linkself-server)
    else
        die 'KIT_MODE must be server or laptop.'
    fi
    compose+=(-f "$stack_root/docker-compose.linkself.yaml" -f "$stack_root/docker-compose.linkself.local.yaml")
    if [[ ${KIT_MODE:-server} == server ]]; then
        compose+=(-f "$kit_dir/docker-compose.server.yaml")
    fi
    dc config --quiet 2>/dev/null || die 'Compose configuration is invalid; check required env values privately.'
}

dc() { "${compose[@]}" "$@"; }

container() {
    local id
    id=$(dc ps --all --quiet "$1")
    [[ -n $id && $id != *$'\n'* ]] || die "Expected one container for $1."
    printf '%s\n' "$id"
}

volume() {
    local id result
    id=$(container "$1")
    result=$(docker inspect --format "{{range .Mounts}}{{if eq .Destination \"$2\"}}{{if eq .Type \"volume\"}}{{.Name}}{{end}}{{end}}{{end}}" "$id")
    [[ -n $result ]] || die "Named volume missing for $1."
    printf '%s\n' "$result"
}

archive_volume() {
    local name
    name=$(volume "$1" "$2")
    docker run --rm --pull never --network none --user 0 \
        --mount "type=volume,src=$name,dst=/data,readonly" \
        --entrypoint tar "$helper_image" -C /data -czf - . > "$3"
}

restore_volume() {
    local name
    name=$(volume "$1" "$2")
    if [[ $replace == true ]]; then
        docker run --rm --pull never --network none --user 0 \
            --mount "type=volume,src=$name,dst=/data" --entrypoint sh "$helper_image" \
            -ec 'find /data -mindepth 1 -maxdepth 1 -exec rm -rf -- {} +'
    else
        docker run --rm --pull never --network none --user 0 \
            --mount "type=volume,src=$name,dst=/data,readonly" --entrypoint sh "$helper_image" \
            -ec 'test -z "$(ls -A /data)"' || die 'Destination volume is not empty; restore refused.'
    fi
    docker run --rm -i --pull never --network none --user 0 \
        --mount "type=volume,src=$name,dst=/data" --entrypoint tar "$helper_image" \
        -C /data -xzpf - < "$3"
}

wait_database() {
    local service=$1 user=$2 database=$3
    for ((attempt=0; attempt<60; attempt++)); do
        if dc exec -T "$service" pg_isready -U "$user" -d "$database" >/dev/null 2>&1; then return; fi
        sleep 2
    done
    die "Database readiness timed out: $service."
}

stop_writers() {
    # Stop the entire studio container, including its PM2 orchestrator and API.
    dc stop -t 120 postiz
    dc stop -t 120 temporal-ui temporal
    dc stop -t 120 temporal-elasticsearch postiz-redis
    local service
    for service in postiz temporal-ui temporal temporal-elasticsearch postiz-redis; do
        [[ $(docker inspect --format '{{.State.Running}}' "$(container "$service")") == false ]] || die "Failed to stop $service."
    done
}
