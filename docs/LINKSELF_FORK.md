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

## Where the source lives
Public repository: https://github.com/Noumenon-ai/linkself-social (branch `linkself-main`). The running service must link here once it
serves users (AGPL-3.0 section 13).

## Modification log
- 2026-10-26: published this fork publicly at the URL above on the owner's instruction.
- 2026-10-26: added docker-compose.linkself.yaml (pinned image ghcr.io/gitroomhq/postiz-app:v2.25.3 by digest, all ports on
  127.0.0.1, env from a file outside the repository, no Spotlight; Elasticsearch kept because Temporal SQL visibility allows only 3 Text search attributes and the backend registers more, which makes it fail to start) and this document. No application code changed.

- 2026-10-26 (P7a; dispatcher commit pending): added replay-protected browser SSO for the organization owner, shared normal
  login/session construction, and isolated backend controller tests. Rebranded product copy, metadata, email templates,
  English translations, public/embedded logos and extension assets as LinkSelf Social; added source attribution and LinkSelf
  login/logout links, removed upstream analytics, and hid self-hosted marketing/support navigation. No upstream copyright
  or licence notices, provider integration logic, posting pipeline, Temporal workflows, Prisma schema or compose file changed.
- 2026-10-27: removed .github/workflows/staging-conflicts.yml. Upstream runs it every 10 minutes against a staging branch
  this fork does not have, so it failed on every run and emailed the owner. Also disabled on GitHub for the published branch.

## Running the staging stack
```
export LINKSELF_SOCIAL_ENV=~/.claude/secrets/linkself-social.env   # chmod 600, never committed
set -a; . $LINKSELF_SOCIAL_ENV; set +a                              # compose needs POSTGRES_PASSWORD on the host side
docker compose -f docker-compose.linkself.yaml up -d
```

Rebranded image built from this tree (LinkSelf Social, browser sign-on): build it, then start the stack with the override so the
pinned upstream image is replaced by the local one:

```
docker build -f Dockerfile.dev -t linkself-social:p7a .
docker compose --env-file $LINKSELF_SOCIAL_ENV -f docker-compose.linkself.yaml -f docker-compose.linkself.local.yaml up -d
curl -s http://localhost:4007/api/health
```
Ports: app 127.0.0.1:4007, Postgres 127.0.0.1:5471, Redis 127.0.0.1:6381, Temporal 127.0.0.1:7233, Temporal UI 127.0.0.1:8081.
Backups: `docker exec linkself-social-postgres pg_dump -U postiz-user postiz-db-local > <file>` and the named volumes.

## LinkSelf browser sign-on and branding

Set `LINKSELF_URL=https://linkself.net` on the frontend server to display **Continue with LinkSelf** above the local
login/register form and return logout to `https://linkself.net/dashboard/social`. `NEXT_PUBLIC_LINKSELF_URL` is an optional
build-time/browser counterpart; set it to the same origin. The server value takes precedence. Local administrator login
continues to work. `NEXT_PUBLIC_APP_NAME` defaults to `LinkSelf Social` in `libraries/helpers/src/app-name.ts`; supply the
same value to both frontend builds and backend processes for consistent page titles, English translations and email copy.

LinkSelf sends the browser to `GET /enterprise/login?params=<JWT>` on the backend. Sign with the existing `JWT_SECRET` and
include `apiKey`, a unique `jti`, numeric `iat`, and numeric `exp` no more than 60 seconds after `iat`. Expired tokens,
future `iat`, missing claims and login/invite/password-reset token shapes are rejected. Redis atomically reserves
`enterprise-login:<jti>` with `SET NX EX 120`; failures, including unavailable Redis, fail closed. The organization must
be active, and its enabled `SUPERADMIN` membership must reference an active, undeleted user. This is the organization
owner role, not the unrelated global `isSuperAdmin` flag checked by the existing administrative API helper.

Successful sign-on uses the same password-free user JWT and session-cookie helper as normal login/register, including
`NOT_SECURED`, cookie domain and one-year cookie expiry, and selects the organization through `showorg`. An optional
`redirect` must begin with `/`, not `//`, contain no backslashes/control characters, and be at most 200 characters; it
defaults to `/launches`. All failures redirect to `/auth/login?error=sso` and log only a fixed reason, never credentials.

The login and settings footers link to this repository with the upstream AGPL attribution. The upstream testimonial
marquee (quotes praising Postiz) is not rendered on the auth pages; the component and its texts stay in the tree unchanged.
Provider setup documentation, package identifiers and technical environment names stay upstream.
The public and embedded application logos and extension icons use the LinkSelf marks. Regenerate SVG, PNG, ICO and extension
manifest names with:

```
pnpm exec ts-node --compiler-options '{"module":"CommonJS"}' scripts/generate-brand-assets.ts
```

Plausible, the Postiz-domain Datafast snippet and Dub affiliate analytics are removed. Facebook pixel and Google tag code
remain gated by their respective nonempty environment variables. Discord support and billing/affiliate navigation are hidden
without `IS_GENERAL`; billing implementations remain available.

Translation follow-up: `i18n.json` uses Lingo with paid OpenAI `gpt-4.1` translation. Only the English source was updated;
`{{appName}}` is supplied by shared i18next interpolation, and the regeneration prompt preserves it. Regenerate/review the
other locales through the configured service when authorized. Existing non-English translations can still contain the
upstream product name. No paid translation calls were made.

P7a validation results and the complete changed-file list are in [P7A_REPORT.md](P7A_REPORT.md).
