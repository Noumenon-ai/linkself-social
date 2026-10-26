# LinkSelf social service: fork notes

This repository is a fork of Postiz (https://github.com/gitroomhq/postiz-app), licensed under the GNU Affero General Public
License v3.0 (see LICENSE). The fork starts at upstream commit a5affe62c74e39c1e7ac960d50d8418b807d532c, tag v2.25.3,
on branch `linkself-main`. The full upstream history is preserved and the `upstream` remote points at the original repository.

## Obligations we accept
- Keep the LICENSE file and all copyright notices.
- Record every modification in the log below with the commit that made it.
- When this service is offered to users over a network, publish the corresponding source of the deployed release and link to it
  from the running service (AGPL-3.0 section 13). Until then the fork runs only on the owner's machine for staging.
- LinkSelf's own application is a separate program in a separate repository and talks to this service over HTTP with
  per-organization API keys. LinkSelf code is not copied into this repository.

## Modification log
- 2026-10-26: added docker-compose.linkself.yaml (pinned image ghcr.io/gitroomhq/postiz-app:v2.25.3 by digest, all ports on
  127.0.0.1, env from a file outside the repository, no Spotlight; Elasticsearch kept because Temporal SQL visibility allows only 3 Text search attributes and the backend registers more, which makes it fail to start) and this document. No application code changed.

## Running the staging stack
```
export LINKSELF_SOCIAL_ENV=~/.claude/secrets/linkself-social.env   # chmod 600, never committed
set -a; . $LINKSELF_SOCIAL_ENV; set +a                              # compose needs POSTGRES_PASSWORD on the host side
docker compose -f docker-compose.linkself.yaml up -d
curl -s http://localhost:4007/api/health
```
Ports: app 127.0.0.1:4007, Postgres 127.0.0.1:5471, Redis 127.0.0.1:6381, Temporal 127.0.0.1:7233, Temporal UI 127.0.0.1:8081.
Backups: `docker exec linkself-social-postgres pg_dump -U postiz-user postiz-db-local > <file>` and the named volumes.
