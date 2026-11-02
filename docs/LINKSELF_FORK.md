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
- 2026-10-30: POST /auth/login and /auth/register allow 10 attempts per 15 minutes per client (ThrottlerSignInGuard, keyed
  by cf-connecting-ip, else the last forwarded hop; IPv6 counted per /64), and the two forms show "Too many attempts" on
  429. The guard assumes the backend is reachable only through Cloudflare. The reset and activation routes stay as
  upstream. The LinkedIn personal provider requests only openid, profile and w_member_social, so it connects with
  LinkedIn's self-serve products, and no longer calls /v2/me (it needs r_basicprofile), so personal channels have an empty
  username. Company lookups and mentions in personal posts need the organization scopes and fail with a message until
  LinkedIn grants them. LinkedIn Page keeps the organization scopes.

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

## Studio fixes (2026-11-02; commit caf5fc74)

`LINKSELF_ENABLED_PROVIDERS` optionally limits new channel connections on the backend. For example,
`LINKSELF_ENABLED_PROVIDERS=bluesky,mastodon,youtube,linkedin,telegram,discord` shows only those identifiers in Add Channel,
onboarding and mobile. List entries ignore surrounding whitespace and case; an unset, empty or whitespace-only value keeps
upstream behavior. Unknown identifiers enable nothing. `HIDDEN_PROVIDERS` still hides entries from the catalog.
Disallowed new connections return HTTP 403 from studio/public URL routes, enterprise URL requests and OAuth/custom-field
callbacks. Reconnect exemptions require an existing channel belonging to the organization and matching the provider (or its
configured migration target). Provider lookup remains unrestricted for existing channels' posting, token refresh, analytics
and deletion.

The shared Google sign-in button is hidden on login and registration when `LINKSELF_URL` or its existing public counterpart
is set. Public post previews use `/logo.svg`, the sidebar's LinkSelf mark, and replace the embedded upstream wordmark with the login's `LogoTextComponent`. The self-hosted OAuth placeholder and displayed MCP
server aliases use LinkSelf; upstream package names, commands, protocol identifiers and documentation URLs remain functional.
AGPL attribution and non-English translations are unchanged. The TikTok instruction now says "you will find".

Invented counts were removed, retaining icons, from TikTok (likes, comments, saves, shares), Pinterest (likes), YouTube
(subscribers, likes), LinkedIn (followers, reactions, comments, reposts and reply engagement), Facebook (reactions, comments
and reply reactions), and Instagram (likes, comments and reply likes).

Pinterest analytics without an `all` payload (including sandbox responses) explicitly return an empty result. Previously
the raw analytics response caused a metrics-destructuring error, which the service swallowed into an empty result; it did not set `refreshNeeded` or another
posting-blocking flag. The Analytics empty state incorrectly treated every empty result as an expired connection. It now
shows "No data yet" unless the channel's actual `refreshNeeded` flag is set. Existing failed token refresh handling still
flags the channel and notifies the user.

Disconnecting a channel preserves its row for post history but clears `token`, `refreshToken`, `tokenExpiration` and
`customInstanceDetails` (including stored custom-provider logins and cookies). Token refresh ignores soft-deleted channels
without calling the provider, flagging them or notifying the user. One-time-token sibling updates only touch live channels
in the same organization, so deleted channels cannot regain credentials through a sibling refresh or reconnect.


## Studio organization limits (2026-11-02; dispatcher commit pending)

`OrganizationLimits` stores each organization's plan, channel allowance, monthly post allowance and MCP access.
With `LINKSELF_URL` set, organizations without a row use Free defaults: 3 channels, 30 posts per month and MCP disabled.
Without `LINKSELF_URL`, quota checks remain unlimited and MCP stays available. An allowance of `-1` means unlimited.
Apply the additive Prisma schema change through the existing deployment process before deploying this feature.

LinkSelf sets limits using `POST /enterprise/limits` with JSON `{ "params": "<JWT>" }`. Sign with the existing
`JWT_SECRET` using HS256 and include `orgId`, `plan` (`free`, `starter` or `pro`), integer `channels` and
`postsPerMonth` (each at least -1), boolean `mcp`, and `iat`, `exp`, `jti`. Tokens must be unexpired, issued no later
than now and valid for at most 60 seconds. Invalid claims/signatures return 400; an absent or deleted organization
returns 404. Repeating a valid token is idempotent and returns HTTP 200 with `{ "ok": true }`; no SSO session or
billing subscription is created. Only the plan and allowances are persisted, not token claims.

New connections are checked at `IntegrationService.assertCanConnect`. Usage counts all non-deleted channels,
including disabled ones, within the organization. Owned live reconnects remain allowed at capacity, and reconnecting
or selecting a page preserves disabled state under LinkSelf. Manual enabling checks the active-channel allowance.
A downgrade disables excess active channels with the existing integration repository operations. An upgrade that
can accommodate all connected channels re-enables disabled channels through the existing enable-all operation;
repeating unchanged limits does not re-enable manually disabled channels. Limits are saved after channel adjustments
succeed, so failed adjustments remain retryable.

`PostsService.createPost` checks the entire request before saving any posts. New post rows count toward the allowance,
so publishing to N channels consumes N posts (thread replies also count as rows). Usage is scoped to the organization
and counts non-deleted rows created during the current UTC calendar month, regardless of their publish date.
Entries editing an existing owned post or group, reschedules and recurring republishes are exempt. A refusal returns
403 with the LinkSelf plan allowance and upgrade message. The existing post saving and workflow-start order is unchanged.
MCP requests return 403 when the organization's `mcp` allowance is false, including authenticated proxy routes.

Authenticated `GET /settings/limits` returns the current organization's limits plus `channelsUsed` and `postsUsed`.
The frontend uses an organization-keyed SWR hook: Add Channel shows channel usage and the LinkSelf upgrade link,
and Settings hides Agents / Dev when MCP is unavailable.

Known limitation: quota checks are ordinary reads before writes, without locks or a transaction context. Concurrent
requests can exceed a limit by a few items; this is accepted, matching LinkSelf's own quotas. Limits updates and channel
disable/re-enable operations likewise use ordinary repository calls, not an atomic cross-repository transaction.

The `updateIntegration` return-shape audit searched the whole repository, including backend, orchestrator, public API
and MCP tools. Its only production caller is `IntegrationService.saveProviderPage`, which ignores the write result and
returns `{ success: true }`. The write therefore selects only the ID, following the existing credential-boundary pattern.
