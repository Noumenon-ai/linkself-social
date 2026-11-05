# Studio server kit

This kit moves the existing studio to Ubuntu 24.04 LTS. It does not change
LinkSelf, DNS, provider settings, or the source machine tunnel. Run commands yourself
at cutover. Keep the source machine and its data until a restore drill and a scheduled
test post have succeeded. Never run both studio workers together.

## 1. Reserve the server and origin

Use 4 vCPU, 8 GB RAM, and at least 75 GB disk, on the same CPU architecture as
the source machine's Docker engine. No production build runs on the server. Container
memory limits total 5.75 GiB: studio 2560 MiB, application Postgres 768 MiB,
Redis 256 MiB, Elasticsearch 768 MiB, Temporal Postgres 512 MiB, Temporal
768 MiB, UI 128 MiB, and Caddy 128 MiB. Elasticsearch keeps its existing
256 MiB minimum and maximum heap. The remainder is for the OS, filesystem
cache, and Docker; 2 GiB swap is an emergency buffer, not extra throughput.
Monitor Redis memory and studio OOM events as traffic grows.

Disk must fit images, live data, fourteen compressed backups, a migration
snapshot, and free working space. A 75 GB disk is only a starting size. Keep
at least 20 percent free, estimate backup size from the source machine, and enlarge
the disk before migrating if it cannot hold this budget. Allow for overlap
while the fifteenth backup is written. Copy backups to private off-server
storage separately; backups on the same disk do not survive server loss.

Choose a separate origin hostname under linkself.net. At the DNS provider for linkself.net, add an A
record for that hostname pointing to the rented server's public IPv4 address.
Keep the DNS provider for linkself.net; do not move
nameservers or change the main site's record. Use a short TTL during cutover.
Do not publish an AAAA record unless IPv6 also reaches this server. Provider
firewalls must permit TCP 22, 80, and 443. Caddy obtains and renews TLS using
the origin hostname; TCP 80 must remain reachable for ACME and redirects.
The origin is public, so retain the application's authentication controls.

The browser URL remains https://linkself.net/dashboard/studio. LinkSelf's
Vercel rewrite uses SOCIAL_ORIGIN_URL=https://<origin-host> as its separate
origin. The path must be forwarded unchanged. Caddy proxies to postiz:5000
without stripping /dashboard/studio. Only Caddy publishes host ports. UFW
alone does not protect ports published by Docker; do not add database ports.

## 2. Bootstrap once

Copy bootstrap.sh and your SSH **public** key to the new server using your
provider's initial access. Verify the host key through the provider console.
Run as root, substituting your chosen admin name and public key path:

```sh
bash bootstrap.sh <admin-user> <public-key-file>
```

The script installs Docker from its official apt repository, the Compose
plugin, UFW, fail2ban, and automatic Ubuntu security updates. It creates the
admin key and Docker group access before disabling password and root SSH
login. It preserves existing Docker configuration apart from log rotation,
sets vm.max_map_count for Elasticsearch, and enables swap only if none exists.
It is safe to rerun; Docker restarts only when its log configuration changes,
so rerun during maintenance if you have changed that configuration. Keep the
initial session and provider console available
until a second admin key login succeeds, including any existing AllowUsers,
Match, or cloud-image access rules. A nonstandard SSH port must be reconciled
with the required port 22 rule before enabling the firewall. Docker group
access is equivalent to root; no passwordless sudo rule is installed. Use the
provider console for future root-only maintenance if needed.

Deployment files go in /srv/linkself-social. Secrets and backups go in the
admin-owned mode 700 /srv/linkself-social-private directory. No secrets belong
in Git. The env file is mode 600. Log rotation is 3 files of 10 MB per
container and applies to newly created containers. Existing swap is retained.

Compose 2.24.4 or newer is required; the override uses `ports: !reset []` to
remove the base file's loopback bindings. Caddy is pinned to 2.11.8-alpine in
docker-compose.server.yaml. Before a cutover, check Caddy's releases, update
that pin if a newer image exists, and run `docker pull` for it on the source machine.
This is a known version, not a claim that it is the latest.

## 3. Prepare the source machine and private env

Use Bash 4+, GNU coreutils/find, flock, Python 3, curl, OpenSSH, tar, Docker,
and Compose. These scripts target a Linux source machine; use its existing Linux
Docker environment if the desktop OS differs. Trust the server host key for
both the SSH target and origin hostname after verifying it independently.
The dry run uses strict host-key checking and will not enroll a new key.

Build the studio image once, before the cutover, with
`--build-arg LINKSELF_BASE_PATH=/dashboard/studio`; the script refuses an image
without it. It differs from the image running on the source machine, which serves the
old address; the database schema must be the same in both. Do not rebuild during
cutover. Stage every dependency image listed by the merged Compose
configuration, including Caddy. The move streams `docker save` into
`docker load` for all of them. Every server service has `pull_policy: never`;
startup and restoration also pass `--pull never`. Container images need no
registry access during migration. Every studio start runs `pnpm dlx prisma@6.5.0`
through `pm2-run` and `prisma-db-push`; outbound npm registry access is required
once its cache is older than a day. Keep that registry access available.

Prepare a separate private server env file outside this repository; do not
edit the source machine's active env file. Preserve all existing application secrets,
especially JWT_SECRET and encryption keys, provider credentials, and the
application database password. Supply the application's existing settings
plus these deployment settings, with real values only in that private file:

- STUDIO_ORIGIN_HOST: the chosen origin hostname, without scheme or path.
- STUDIO_IMAGE: the staged studio tag. Required.
- POSTGRES_PASSWORD: the existing application database password.
- TEMPORAL_POSTGRES_PASSWORD: a new private strong password for the destination
  Temporal database. The override replaces the base stack's development value
  in both the database and Temporal service. Dumps exclude role passwords;
  restoration uses the destination role created from this value.
- DATABASE_URL: the existing application's connection string with host
  postiz-postgres, port 5432, user postiz-user, and database postiz-db-local.
  URL-encode the password as required.
- REDIS_URL: redis://postiz-redis:6379, and TEMPORAL_ADDRESS: temporal:7233.
- LINKSELF_BASE_PATH: /dashboard/studio and LINKSELF_URL: https://linkself.net.
- FRONTEND_URL: https://linkself.net/dashboard/studio and
  NEXT_PUBLIC_BACKEND_URL: https://linkself.net/dashboard/studio/api.
- UPLOAD_DIRECTORY: /uploads. Keep the existing storage configuration.
  NEXT_PUBLIC_UPLOAD_STATIC_DIRECTORY for new files should be
  https://linkself.net/dashboard/studio/uploads.

Keep all other working LinkSelf SSO and application settings. Use dotenv
syntax, not shell commands. Never source this file or print `compose config`
with real values. Scripts use `--env-file` and silent validation. Do not set
LINKSELF_SOCIAL_ENV in the file; scripts supply its absolute path. If a value
contains `$`, single-quote the entire value so Compose preserves it literally.
The scripts refuse other values containing `$` and report only the variable
name. Comments and blank lines are ignored.

The dry run checks the existing containers and image identities, the merged
configuration, SSH, DNS reaching the same Docker engine, CPU architecture,
destination directories, Compose version, and free ports. HTTPS cannot work
on a fresh destination before Caddy starts, so TLS health is checked after
restoration. Review disk capacity on both machines before applying.

```sh
chmod 600 "$SERVER_ENV"
bash var/docker/server/move-to-server.sh --dry-run --image "$IMAGE_TAG" "$SERVER" "$ORIGIN_HOST" "$SERVER_ENV"
```

SERVER is admin@<server-host>; ORIGIN_HOST is the separate hostname. Set these
shell variables privately. No server hostname, address, or token is checked
into this kit. The script requires an unused destination project and private
directory. Existing deployment data is never silently overwritten.

## 4. Cut over

Freeze studio edits and notify users of the maintenance window. Save the old
LinkSelf production origin setting and provider redirect URIs privately.
Reserve enough time for the image transfer and database/volume sizes; an hour
is a rollback target, not a guarantee for an arbitrarily large dataset.

```sh
bash var/docker/server/move-to-server.sh --apply --image "$IMAGE_TAG" "$SERVER" "$ORIGIN_HOST" "$SERVER_ENV"
```

Images, Compose files, dynamicconfig, and this kit transfer first. The env is
copied over SSH to /srv/linkself-social-private/studio.env with mode 600.
Existing STUDIO_ORIGIN_HOST and STUDIO_IMAGE lines are removed before the
arguments are appended, so each appears once. The script stops PM2 workers
first, then stops the source machine postiz container with a 15-second timeout,
followed by Temporal, its UI, Elasticsearch, and Redis. Both databases remain
running for dumps. Nothing on the source machine is deleted, including old backups.
Set MIGRATION_BACKUP_ROOT to a private directory outside the repository; local
snapshots go there, with modes 700 and 600.

Application Postgres is dumped in custom format. Every non-template Temporal
database other than the unused postgres maintenance database is dumped, so
history, task queues, timers, and SQL visibility (if present) survive. Roles
are supplied by Compose; this stack uses only postiz-user and temporal.
Elasticsearch is the enabled visibility store in the base Compose file.
Its stopped data volume is copied with ownership intact and restored only
with the same image reference as the snapshot. Visibility is **not** discarded or rebuilt.
Redis is also copied while stopped. Uploads and config are copied while no
studio writer is running. Existing dynamicconfig is transferred unchanged.

Checksums must pass before restore. The destination restores volumes and
databases, waits for Temporal cluster health, then starts the studio and
Caddy. Jobs whose times passed during downtime can fire immediately on
startup. The script polls the exact origin HTTPS can-register route with
certificate validation enabled. No failure automatically restarts the source machine.
Keep both machines from rebooting during cutover: unless-stopped services
that were explicitly stopped remain stopped, but never rely only on that
policy when confirming that there is one publisher.

The private migration-started marker is written immediately before stopping
the source stack, after image/file transfer and validation. A failure before
that stage stops nothing and can be retried. An interruption from that stage
on leaves the marker. Do not
blindly rerun or remove it: inspect service state and the completed snapshot,
then finish the restore/start sequence manually or follow rollback below.
The marker intentionally prevents a second cutover overwriting evidence.

## 5. Manual steps after origin health

Set SOCIAL_ORIGIN_URL=https://<origin-host> in LinkSelf's production env and
redeploy its Vercel rewrite. Check https://linkself.net/dashboard/studio and
its uploads route before rewriting stored addresses.

On the server, open an admin Bash session. Set OLD_UPLOAD_ORIGIN to the
previous upload origin. Inspect the dry-run counts before applying:

```sh
cd /srv/linkself-social
bash var/docker/server/dc.sh /srv/linkself-social-private/studio.env exec -T postiz pnpm uploads:rewrite-origin --from="$OLD_UPLOAD_ORIGIN" --to=https://linkself.net/dashboard/studio </dev/null
bash var/docker/server/dc.sh /srv/linkself-social-private/studio.env exec -T postiz pnpm uploads:rewrite-origin --from="$OLD_UPLOAD_ORIGIN" --to=https://linkself.net/dashboard/studio --apply </dev/null
```

The `dc.sh ENV_FILE <compose arguments>` wrapper runs Compose for this stack.
It defaults to KIT_MODE=server; KIT_MODE=source uses the source machine's
original project and two base Compose files.
See scripts/migrate-upload-origin.md in the source repository for the column
inventory and conflict handling. Stored upload addresses move to
https://linkself.net/dashboard/studio/uploads/, the same place new uploads use.

Update provider redirect URIs to the exact browser-facing
https://linkself.net/dashboard/studio callback URLs shown by each integration's
setup screen; keep provider-specific callback suffixes. Verify SSO login,
media, OAuth, and a scheduled test post through LinkSelf. Only then stop the
old tunnel. None of these steps is automated by the kit.

## 6. Nightly backup and restore drill

Install this in the admin user's crontab, using the private paths as written:

```cron
7 3 * * * /bin/bash /srv/linkself-social/var/docker/server/backup.sh /srv/linkself-social-private/studio.env /srv/linkself-social-private/backups >> /srv/linkself-social-private/backup-cron.log 2>&1
```

Minute 7 avoids quarter hours, when posts are usually scheduled. A publish
running at the exact moment of a stop can be interrupted; Temporal then retries
it. Create backup-cron.log with mode 600 first. Rotate that log separately. The
backup pauses studio publishing and Temporal while taking a coherent snapshot;
schedule this short maintenance window for low usage. Services that were
running are restarted on exit, including after backup failure. Failures exit
nonzero; monitor the cron exit/log and alert if no new COMPLETE snapshot
appears. A database error is stored in the private snapshot database.log, never
printed. Incomplete snapshots are not restorable and are not pruned; investigate
and remove them manually after resolving failures. Successful backups prune
complete snapshots at least fourteen days old. A lock prevents overlapping
backups. Copy the private env and images to encrypted off-server storage too;
snapshots intentionally do not contain the env file or role passwords.

Test a restore on a separate disposable machine with the same architecture,
staged images with the same references, and private env. Block outbound
provider access there before ever starting a studio worker; keep npm registry
access available for startup. Copy docker-compose.linkself.yaml,
docker-compose.linkself.local.yaml, the entire dynamicconfig directory, and
the entire var/docker/server directory, preserving their relative paths under
the deployment directory. Copy a complete snapshot and the mode-600 private
env outside that directory, then:

```sh
bash var/docker/server/restore.sh --apply "$RESTORE_ENV" "$SNAPSHOT"
```

Fresh restore refuses existing project containers and nonempty data volumes.
It starts only the two databases, leaving publishers stopped. Compare counts
of organizations, integrations, posts, and Temporal executions against the
source; start only Elasticsearch and Temporal to check visibility and history.
Run a controlled test schedule with provider traffic blocked before destroying
the drill host. A successful checksum check alone is not a restore test.

For intentional recovery on an existing destination, stop every service,
save a backup first, and add `--replace`. This clears uploads/config/Redis/ES
destination contents and replaces application and Temporal databases. It is
destructive to that destination and is never chosen by the migration script.
Keep the snapshot and private restore.log on failure; publishers remain stopped.

## 7. Roll back within the same hour

Keep users frozen. First stop workers and postiz on the server and verify it
is stopped. Do this even if HTTPS failed: workers can publish before TLS is
healthy. If postiz is already stopped, skip the PM2 command:

```sh
cd /srv/linkself-social
bash var/docker/server/dc.sh /srv/linkself-social-private/studio.env exec -T postiz sh -c 'cd /app && pnpm exec pm2 stop all' </dev/null
bash var/docker/server/dc.sh /srv/linkself-social-private/studio.env stop -t 15 postiz
bash var/docker/server/dc.sh /srv/linkself-social-private/studio.env ps --all postiz
```

If server postiz never started, the source snapshot is still authoritative.
Stop the whole destination stack. Restore the old LinkSelf origin setting,
redeploy, restore provider redirects, and restart the old tunnel. On the
source machine, use the original env and project, start Redis, Elasticsearch,
and Temporal, wait for Temporal health, then start postiz and the UI. Check
HTTPS and a scheduled test job before unfreezing users.

If server postiz started at all, use its latest state to avoid replaying jobs
already published. If upload URLs were rewritten, reverse them on the server
before taking the rollback snapshot. The old image may not contain the tool.
Set OLD_UPLOAD_ORIGIN to the previous upload origin; these one-off containers
start no workers. Inspect the dry-run counts before applying:

```sh
bash var/docker/server/dc.sh /srv/linkself-social-private/studio.env run --rm --no-deps -T postiz sh -c 'cd /app && pnpm uploads:rewrite-origin --from=https://linkself.net/dashboard/studio --to="$1"' sh "$OLD_UPLOAD_ORIGIN" </dev/null
bash var/docker/server/dc.sh /srv/linkself-social-private/studio.env run --rm --no-deps -T postiz sh -c 'cd /app && pnpm uploads:rewrite-origin --from=https://linkself.net/dashboard/studio --to="$1" --apply' sh "$OLD_UPLOAD_ORIGIN" </dev/null
bash var/docker/server/backup.sh /srv/linkself-social-private/studio.env /srv/linkself-social-private/rollback --leave-stopped
bash var/docker/server/dc.sh /srv/linkself-social-private/studio.env stop -t 120
```

Transfer that COMPLETE snapshot over SSH to a private source machine directory.
Keep the original cutover snapshot. With the server fully stopped, on the
source machine use its original env file and the returned snapshot:

```sh
export KIT_MODE=source
bash var/docker/server/dc.sh "$SOURCE_ENV" stop -t 120
bash var/docker/server/restore.sh --apply "$SOURCE_ENV" "$RETURNED_SNAPSHOT" --replace
bash var/docker/server/dc.sh "$SOURCE_ENV" up -d --pull never postiz-redis temporal-elasticsearch temporal
bash var/docker/server/dc.sh "$SOURCE_ENV" exec -T temporal temporal operator cluster health --address temporal:7233 </dev/null
```

Repeat the health command until it succeeds, then run:

```sh
bash var/docker/server/dc.sh "$SOURCE_ENV" up -d --pull never postiz temporal-ui
```

Restore the old LinkSelf origin, provider redirects, and tunnel. Verify media
paths for any new uploads created on the server too. Keep the server stopped
throughout. Do not resume stale source state after server publishing; extend
maintenance if reverse transfer cannot finish within the hour. Provider-side
actions already in flight must be reconciled against provider delivery records;
no infrastructure snapshot can undo a published post.

## 8. Health, disk pressure, and later image updates

In an admin server shell, set ORIGIN_HOST to the chosen origin hostname:

```sh
cd /srv/linkself-social
ORIGIN_HOST='<origin-host>'
bash var/docker/server/dc.sh /srv/linkself-social-private/studio.env ps
bash var/docker/server/dc.sh /srv/linkself-social-private/studio.env logs --tail=100 caddy postiz temporal
bash var/docker/server/dc.sh /srv/linkself-social-private/studio.env exec -T temporal temporal operator cluster health --address temporal:7233 </dev/null
curl --fail --silent --show-error "https://$ORIGIN_HOST/dashboard/studio/api/auth/can-register"
docker stats --no-stream
df -h /srv /var/lib/docker
docker system df
```

Treat logs as private: application/provider logs may contain personal data.
Never paste env contents or expanded Compose config into an issue. Postgres
and Redis readiness are available through `dc.sh ENV_FILE ps`; Temporal and origin HTTPS need
the explicit checks above. The internal Temporal UI has no public host port.

If disk space runs low, stop postiz to halt writes, inspect image usage and
backup sizes, and expand the disk or move verified backups off-server. Remove
only reviewed old backups and explicitly identified unused images. Do not
delete live volumes, run volume prune, or delete PostgreSQL/Elasticsearch
files. Check private failed-backup directories and the cron log as well as
container logs. After freeing space, check Postgres/ES health and resolve any
ES flood-stage write block through its internal API before restarting writers.
The low existing ES disk watermarks are a last guard; monitor capacity well
before they are reached. Re-test both health routes after recovery.

To update later, build and test a new version on the source machine separately. Keep
the previous image loaded on the server. Transfer the new tag using
`docker save "$NEW_IMAGE_TAG" | ssh "$SERVER" docker load`. Take a full backup
and freeze edits, then stop postiz. Update STUDIO_IMAGE only in the server's
private env file and retain mode 600. Run
`bash var/docker/server/dc.sh /srv/linkself-social-private/studio.env up -d --no-deps --pull never postiz`, then check origin health and a test
post. The image startup performs database schema synchronization, so an image
rollback may also require restoring the pre-update backup. Do not downgrade
over a changed schema without checking compatibility. Update dependency pins
and Elasticsearch versions in a separately tested maintenance procedure;
the raw ES volume backup requires its original image for restoration.
