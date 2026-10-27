# P7a handoff (2026-10-26)

Implemented LinkSelf Social branding and organization-owner browser SSO; production builds and 27 controller tests pass.
Clean lint is BLOCKED by the existing root ESLint configuration and existing source violations. No checks were weakened.

## Final validation

- `pnpm --filter ./apps/backend run build`: PASS: 1 build, 0 errors.
- `NODE_OPTIONS=--max-old-space-size=4096 pnpm --filter ./apps/frontend run build`: PASS: 1 build, 0 errors; 2/2 static pages generated.
- `pnpm exec jest --config apps/backend/jest.enterprise.config.cjs --runInBand`: PASS: 1 suite, 27 tests, 0 failed, 0 snapshots.
- `pnpm exec eslint apps/backend/src/api/routes/enterprise.controller.ts apps/backend/src/api/routes/enterprise.controller.spec.ts apps/backend/src/api/routes/auth.controller.ts apps/backend/src/services/auth/session.ts apps/backend/src/services/auth/auth.service.ts apps/frontend/src`: BLOCKED before linting: root FlatCompat configuration throws `TypeError: Converting circular structure to JSON`; exit 2.
- `pnpm exec eslint --config apps/frontend/eslint.config.mjs apps/frontend/src`: FAIL: 339 files; 600 errors, 780 warnings; exit 1.
- `pnpm exec eslint --config apps/frontend/eslint.config.mjs apps/backend/src/api/routes/enterprise.controller.ts apps/backend/src/api/routes/enterprise.controller.spec.ts apps/backend/src/api/routes/auth.controller.ts apps/backend/src/services/auth/session.ts apps/backend/src/services/auth/auth.service.ts`: FAIL: 5 files; 10 errors, 10 warnings; exit 1.
- `pnpm exec eslint --config apps/frontend/eslint.config.mjs apps/backend/src/api/routes/enterprise.controller.spec.ts apps/backend/src/services/auth/session.ts apps/frontend/src/components/auth/linkself-login.tsx apps/frontend/src/components/auth/source-attribution.tsx libraries/helpers/src/app-name.ts scripts/generate-brand-assets.ts`: PASS: 6 new source files, 0 errors, 0 warnings; exit 0.
- `pnpm exec ts-node --compiler-options '{"module":"CommonJS"}' scripts/generate-brand-assets.ts`: PASS: 7 frontend marks/icons, 2 extension icons and 2 manifest names generated.
- `git diff --check`: PASS: 0 whitespace errors.
- `grep -rIn "Postiz" apps/frontend/src --include='*.tsx' --include='*.ts'`: 2 hits, both attribution; listed below.

No package-level lint script exists. The existing frontend flat configuration was used as the fallback without changing
any lint rules. A read-only FlatESLint comparison against `git show HEAD:<path>` found 600 frontend errors at baseline too
(781 baseline warnings). For the 50 modified frontend/backend source files, both baseline and current code have 47 errors;
there are 0 added errors when compared by file, rule and diagnostic headline. The new source files lint cleanly. The Next
lint configuration also prints a pre-existing pages-directory advisory when invoked from the repository root.

The environment reports Node 22.13.1 while package.json requests 22.23.4; both builds still succeeded. No apps or Docker
containers were started. No dependencies, provider integration logic, posting pipeline, Temporal workflows, Prisma schema,
compose configuration, licence notices or upstream copyrights were changed. Provider-screen changes are display copy only.
No git commits or pushes were made.

## Remaining frontend Postiz hits

- `apps/frontend/src/components/auth/source-attribution.tsx:4`: `Built on Postiz (AGPL-3.0). Source:` - required AGPL/upstream attribution, linking to `https://github.com/Noumenon-ai/linkself-social` on login and settings.
- Testimonials: the upstream testimonial marquee is no longer rendered on the auth pages (dispatcher correction after seeing the Postiz quotes on the live staging login page; IS_GENERAL is true in every self-hosted install, so gating on it was not enough). The component file is unchanged from upstream.

## Follow-up

- Repair the existing root lint configuration and source lint backlog in a separate task. No lint or security rules were disabled here.
- Regenerate/review non-English locales using the paid OpenAI/Lingo configuration when authorized. Only English and the regeneration prompt were changed, as requested.
- Set `LINKSELF_URL` (and optionally matching `NEXT_PUBLIC_LINKSELF_URL`) to enable the LinkSelf login/logout destinations. Set `NEXT_PUBLIC_APP_NAME` consistently for backend and frontend if overriding the default.
- The dispatcher should verify and commit the changes; the fork modification log records the date and pending commit.

## Changed files

82 files changed or added:

```text
.env.example
DESIGN_IDENTITY.json
apps/backend/jest.enterprise.config.cjs
apps/backend/src/api/routes/auth.controller.ts
apps/backend/src/api/routes/enterprise.controller.spec.ts
apps/backend/src/api/routes/enterprise.controller.ts
apps/backend/src/services/auth/auth.service.ts
apps/backend/src/services/auth/session.ts
apps/extension/manifest.dev.json
apps/extension/manifest.json
apps/extension/public/icon-128.png
apps/extension/public/icon-32.png
apps/frontend/public/favicon.ico
apps/frontend/public/favicon.png
apps/frontend/public/logo-text.svg
apps/frontend/public/logo.svg
apps/frontend/public/postiz-fav.png
apps/frontend/public/postiz-text.svg
apps/frontend/public/postiz.svg
apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx
apps/frontend/src/app/(app)/(site)/admin/errors/page.tsx
apps/frontend/src/app/(app)/(site)/admin/stats/page.tsx
apps/frontend/src/app/(app)/(site)/agents/[id]/page.tsx
apps/frontend/src/app/(app)/(site)/agents/layout.tsx
apps/frontend/src/app/(app)/(site)/agents/page.tsx
apps/frontend/src/app/(app)/(site)/analytics/page.tsx
apps/frontend/src/app/(app)/(site)/billing/lifetime/page.tsx
apps/frontend/src/app/(app)/(site)/billing/page.tsx
apps/frontend/src/app/(app)/(site)/launches/page.tsx
apps/frontend/src/app/(app)/(site)/media/page.tsx
apps/frontend/src/app/(app)/(site)/settings/page.tsx
apps/frontend/src/app/(app)/auth/activate/[code]/page.tsx
apps/frontend/src/app/(app)/auth/activate/page.tsx
apps/frontend/src/app/(app)/auth/forgot/[token]/page.tsx
apps/frontend/src/app/(app)/auth/forgot/page.tsx
apps/frontend/src/app/(app)/auth/layout.tsx
apps/frontend/src/app/(app)/auth/login/page.tsx
apps/frontend/src/app/(app)/auth/page.tsx
apps/frontend/src/app/(app)/layout.tsx
apps/frontend/src/components/agents/agent.chat.tsx
apps/frontend/src/components/approved-apps/approved-apps.component.tsx
apps/frontend/src/components/auth/linkself-login.tsx
apps/frontend/src/components/auth/providers/farcaster.provider.tsx
apps/frontend/src/components/auth/source-attribution.tsx
apps/frontend/src/components/auth/testimonial.component.tsx
apps/frontend/src/components/billing/faq.component.tsx
apps/frontend/src/components/billing/first.billing.component.tsx
apps/frontend/src/components/developer/developer.component.tsx
apps/frontend/src/components/launches/add.provider.component.tsx
apps/frontend/src/components/launches/hubspot.installed.tsx
apps/frontend/src/components/launches/web3/providers/moltbook.provider.tsx
apps/frontend/src/components/layout/dubAnalytics.tsx
apps/frontend/src/components/layout/layout.context.tsx
apps/frontend/src/components/layout/logout.component.tsx
apps/frontend/src/components/layout/pre-condition.component.tsx
apps/frontend/src/components/layout/support.tsx
apps/frontend/src/components/layout/top.menu.tsx
apps/frontend/src/components/new-launch/media.settings.section.tsx
apps/frontend/src/components/new-launch/providers/tiktok/tiktok.provider.tsx
apps/frontend/src/components/new-layout/billing.after.tsx
apps/frontend/src/components/new-layout/logo.tsx
apps/frontend/src/components/oauth/authorize.component.tsx
apps/frontend/src/components/oauth/self.hosted.component.tsx
apps/frontend/src/components/onboarding/onboarding.modal.tsx
apps/frontend/src/components/onboarding/onboarding.tsx
apps/frontend/src/components/public-api/public.component.tsx
apps/frontend/src/components/ui/logo-text.component.tsx
apps/frontend/src/components/webhooks/webhooks.tsx
docs/LINKSELF_FORK.md
docs/P7A_REPORT.md
i18n.json
libraries/helpers/src/app-name.ts
libraries/helpers/src/swagger/load.swagger.ts
libraries/nestjs-libraries/src/database/prisma/agencies/agencies.service.ts
libraries/nestjs-libraries/src/database/prisma/organizations/organization.repository.ts
libraries/nestjs-libraries/src/database/prisma/organizations/organization.service.ts
libraries/nestjs-libraries/src/database/prisma/users/users.service.ts
libraries/nestjs-libraries/src/newsletter/providers/listmonk.provider.ts
libraries/react-shared-libraries/src/helpers/variable.context.tsx
libraries/react-shared-libraries/src/translation/i18next.ts
libraries/react-shared-libraries/src/translation/locales/en/translation.json
scripts/generate-brand-assets.ts
```
