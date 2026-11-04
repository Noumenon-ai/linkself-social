# Glass frame implementation report

Implemented the approved LinkSelf-only Glass frame identity, Figtree, calendar date tiles and loaded-data Scheduled column; upstream theme fallbacks and existing post actions remain available.

## Validation

| Exact command | Final result |
| --- | --- |
| `pnpm exec jest --config apps/backend/jest.enterprise.config.cjs --runInBand` | Baseline: 16 suites, 254 tests passed. Final: 16 suites, 254 tests passed; 0 failed, 0 snapshots. |
| `pnpm exec tsc --project apps/frontend/tsconfig.json --noEmit --incremental false` | Exit 0; 0 TypeScript errors. |
| `node scripts/check-glass-css.cjs` | Before review: 954 checks. Final: 988 checks passed, 0 failed; Sass and Tailwind compilation passed. |
| `node scripts/check-glass-calendar.cjs` | Before review: 26 checks. Final: 90 checks passed, 0 failed. |
| `git diff --check` | Exit 0; 0 whitespace errors. |

CSS checks retain the original compiled utility/fallback assertions and add exact contract tokens, theme and font gating, local font headers/license, retired identity scanning, breakpoint rules, literal palette enforcement and contrast against a frame over a worst-case white band. Text on selected dates and primary buttons also passes contrast checks.

Calendar checks execute the actual TSX declarations without starting the app. They cover timezone day boundaries using the existing timezone implementation, sorting, selected/day/list sources, empty/loading states, channel colors, upstream gating, no extra request for selected-day creation, editor integration initialization and unsaved-close protections. They also cover the existing missing-release/statistics routing and preserved month-view edit, duplicate, preview and delete actions.

During the original implementation, a second agent reviewed the changes as required by CLAUDE.md. Its findings about CSS specificity, upstream title layout, empty-state editor initialization, preserved post actions, mobile channel navigation and public-preview empty-state layout were addressed.

## Review fixes (2026-11-04)

All 13 findings were confirmed by reading the current code and, for slot keyboard behavior, comparing the original HEAD implementation. The existing uncommitted Glass frame work was retained.

1. Event paragraph text no longer receives tick dimensions; only the footer pseudo-element carries the status tick.
2. The animation/opacity audit found Notifications as the sole entry-animated element with a permanent `opacity-0` base. Glass entry-animation classes now explicitly render at full opacity without motion. The audit also covered modals, date pickers, sheets, billing panels, drop overlays, toasts, and vendor styles. Hover/drag visibility controls retain their state-dependent opacity; completed upload progress already has an explicit hidden state.
3. Calendar context synchronizes selected day when the range changes: today inside the range, otherwise its first day. Date selection loads the containing day/week/month range; a date picked from the paginated list switches to day view. Deep links initialize selection inside their range. New Post retains the selected date, including past dates; today's default time retains the existing ten-minute lead.
4. Month ticks expose status through accessible labels and error/success marks, preserve the actual error tooltip, and offer Open post for ERROR posts with a release URL. Phone targets are at least 44px tall. Pointer and keyboard activation stop propagation into create-post controls.
5. Glass headings use the actual day or week endpoints; navigation visibly updates them.
6. All tools closes on link activation, outside pointer press, Escape, and custom-modal opening. Escape restores summary focus. The rail and menu stay below the first modal, and modal overlays disable pointer access to the tools. Document handlers are cleaned up on unmount.
7. A confirmed, successful DELETE closes only the deleted post's details modal after refreshing the calendar. Cancellation, unsuccessful HTTP responses, and thrown requests leave it open.
8. Shared Input marks empty-label rows so controls and errors span the full modal grid, including the cited connection dialogs. No provider file was edited for this fix.
9. `--new-bgColorInner` maps to opaque `--popover`; `--popup-color` is page RGB at 0.72 alpha. Mantine overlays use the same dimming token.
10. Removed the nonexistent LinkSelf footer Help link.
11. Disabled/busy controls and their accent descendants use inset/muted colors without accent hover or shadows.
12. Removed the introduced slot role, tab index, and key handler in both modes. The original pointer-only route remains; existing post/date controls retain their keyboard behavior.
13. Calendar arrows rotate in RTL, and tools/rail tooltips use logical inline positioning.

The extended checks execute the actual provider, Filters, ScheduledPosts, CalendarItem, CalendarColumn, post-action and All tools declarations with local hook/data stubs. They cover navigation and SWR query changes, date headings, selected-day creation, deep links, tick accessibility and propagation, both modes' slot tab order, menu dismissal/cleanup, and DELETE success/cancel/failure. CSS checks cover the corresponding compiled styles, overlay colors, stacking, logical positioning, visibility, empty-label grids, and disabled descendants. Existing assertions were retained.

Jest used `TMPDIR="$PWD/.cache/glass-review"` to keep its temporary cache inside the worktree; that cache was removed after the run. No app or browser session was started, so these checks do not claim rendered screenshots or live touch/drag verification.

Files edited for this review pass:

- `apps/frontend/src/app/colors.scss`
- `apps/frontend/src/app/global.scss`
- `apps/frontend/src/components/launches/calendar.context.tsx`
- `apps/frontend/src/components/launches/calendar.tsx`
- `apps/frontend/src/components/launches/filters.tsx`
- `apps/frontend/src/components/layout/new-modal.tsx`
- `apps/frontend/src/components/layout/top.menu.tsx`
- `apps/frontend/src/components/new-layout/layout.component.tsx`
- `libraries/react-shared-libraries/src/form/input.tsx`
- `scripts/check-glass-css.cjs`
- `scripts/check-glass-calendar.cjs`
- `docs/GLASS_FRAME_REPORT.md`

## Source audits

The following source audit was recorded during the original implementation, before these review fixes. Its line counts and color inventory are historical; the final compiled palette check above validates the current styles. The commands were run from the repository root. The changed frontend list includes added files and excludes deleted files.

```bash
mapfile -d '' -t glass_frontend_files < <(git diff --name-only --diff-filter=ACM -z -- apps/frontend)
mapfile -d '' -t glass_new_files < <(git ls-files --others --exclude-standard -z -- apps/frontend)
glass_frontend_files+=("${glass_new_files[@]}")
rg -n -i 'blueprint|#(1B3A5C|143049|EAF2FA|A9C1D9|2E5379|FF7A45|12161C)\b' "${glass_frontend_files[@]}"
rg -n '#[0-9A-Fa-f]{3,8}\b|rgba?\(' "${glass_frontend_files[@]}" > docs/GLASS_FRAME_COLOR_AUDIT.txt
wc -l docs/GLASS_FRAME_COLOR_AUDIT.txt
```

- Retired identity/palette grep: 0 matches (rg exit 1, expected).
- Color grep: 456 matching source lines, recorded in `GLASS_FRAME_COLOR_AUDIT.txt`. These include approved tokens and bands, unchanged upstream theme definitions, explicit non-LinkSelf chart/billing branches, and existing semantic-variable fallback colors. The source intentionally retains upstream colors to preserve upstream installs.
- Compiled Glass rules: 0 out-of-contract literal colors, enforced by `check-glass-css.cjs`. Primary and muted text, link text, buttons and selected-date text pass the checked contrast combinations.
- External BlueprintJS/Polotno package names and their unchanged vendor stylesheet remain dependency identifiers; they are not the removed design identity. The checker permits only those dependency identifiers, not retired theme hooks or values.

## Scope and remaining verification

All requested visual surface families use the new gated tokens and shared controls. Calendar day/week/list actions remain; month posts use draggable channel ticks and a detail popup exposing the existing actions. The schedule reads only current-view context data, follows channel filtering, and shows a real empty state for a day without loaded posts. Its column is 260px at widths of 1000px and above and stacks below at smaller widths.

The shared network-preview wrapper has only its CSS hook renamed; native network simulations and provider implementations are preserved. No backend, schema, workflow/activity, environment, Docker, dependency or provider integration behavior was changed. No network calls, production builds, app starts, commits or pushes were performed.

No requested visual surface was intentionally left on the retired theme. Browser rendering, drag/drop interaction in the running app, screenshots and deployment are reserved for the dispatcher per the task; these have not been claimed as verified.

## Every changed file

Status: M modified; D deleted; A added (including renamed-file destinations).

- M `DESIGN_IDENTITY.json`
- D `apps/frontend/public/blueprint-icon.svg`
- M `apps/frontend/src/app/(app)/(preview)/p/[id]/layout.tsx`
- M `apps/frontend/src/app/(app)/(preview)/p/[id]/page.tsx`
- M `apps/frontend/src/app/(app)/auth/layout.tsx`
- M `apps/frontend/src/app/(app)/layout.tsx`
- M `apps/frontend/src/app/(extension)/layout.tsx`
- M `apps/frontend/src/app/(provider)/layout.tsx`
- M `apps/frontend/src/app/colors.scss`
- M `apps/frontend/src/app/global.scss`
- M `apps/frontend/src/components/analytics/chart-social.tsx`
- M `apps/frontend/src/components/analytics/chart.tsx`
- M `apps/frontend/src/components/billing/embedded.billing.tsx`
- M `apps/frontend/src/components/billing/first.billing.component.tsx`
- M `apps/frontend/src/components/billing/main.billing.component.tsx`
- M `apps/frontend/src/components/developer/developer.component.tsx`
- M `apps/frontend/src/components/launches/ai.image.tsx`
- M `apps/frontend/src/components/launches/calendar.context.tsx`
- M `apps/frontend/src/components/launches/calendar.tsx`
- M `apps/frontend/src/components/launches/continue.integration.tsx`
- M `apps/frontend/src/components/launches/creation.method.badge.tsx`
- M `apps/frontend/src/components/launches/filters.tsx`
- M `apps/frontend/src/components/launches/general.preview.component.tsx`
- M `apps/frontend/src/components/launches/launches.component.tsx`
- M `apps/frontend/src/components/launches/new.post.tsx`
- M `apps/frontend/src/components/launches/repeat.component.tsx`
- M `apps/frontend/src/components/launches/select.customer.tsx`
- M `apps/frontend/src/components/launches/statistics.tsx`
- M `apps/frontend/src/components/launches/tags.component.tsx`
- M `apps/frontend/src/components/launches/time.table.tsx`
- M `apps/frontend/src/components/layout/logout.component.tsx`
- M `apps/frontend/src/components/layout/new-modal.tsx`
- M `apps/frontend/src/components/layout/top.menu.tsx`
- M `apps/frontend/src/components/media/media.component.tsx`
- M `apps/frontend/src/components/new-launch/add.post.button.tsx`
- M `apps/frontend/src/components/new-launch/delay.component.tsx`
- M `apps/frontend/src/components/new-launch/editor.tsx`
- M `apps/frontend/src/components/new-launch/manage.modal.tsx`
- M `apps/frontend/src/components/new-launch/mobile.top.bar.tsx`
- M `apps/frontend/src/components/new-launch/providers/high.order.provider.tsx`
- M `apps/frontend/src/components/new-launch/select.current.tsx`
- M `apps/frontend/src/components/new-layout/layout.component.tsx`
- M `apps/frontend/src/components/new-layout/layout.media.component.tsx`
- M `apps/frontend/src/components/new-layout/logo.tsx`
- M `apps/frontend/src/components/new-layout/menu-item.tsx`
- M `apps/frontend/src/components/notifications/notification.component.tsx`
- M `apps/frontend/src/components/oauth/authorize.component.tsx`
- M `apps/frontend/src/components/oauth/self.hosted.component.tsx`
- M `apps/frontend/src/components/onboarding/onboarding.modal.tsx`
- M `apps/frontend/src/components/platform-analytics/render.analytics.tsx`
- M `apps/frontend/src/components/plugs/plug.tsx`
- M `apps/frontend/src/components/plugs/plugs.tsx`
- M `apps/frontend/src/components/public-api/public.component.tsx`
- M `apps/frontend/src/components/sets/sets.tsx`
- M `apps/frontend/src/components/settings/apps.component.tsx`
- M `apps/frontend/src/components/settings/signatures.component.tsx`
- M `apps/frontend/src/components/third-parties/third-party.media-library.tsx`
- D `apps/frontend/src/components/ui/blueprint-brand.tsx`
- M `apps/frontend/src/components/ui/logo-text.component.tsx`
- D `apps/frontend/src/fonts/blueprint/OFL.txt`
- D `apps/frontend/src/fonts/blueprint/architects-daughter-400.woff2`
- D `apps/frontend/src/fonts/blueprint/archivo-400.woff2`
- D `apps/frontend/src/fonts/blueprint/archivo-600.woff2`
- D `apps/frontend/src/fonts/blueprint/archivo-700.woff2`
- D `apps/frontend/src/fonts/blueprint/blueprint.font.ts`
- D `apps/frontend/src/fonts/blueprint/space-mono-400.woff2`
- M `apps/frontend/tailwind.config.cjs`
- M `libraries/react-shared-libraries/src/form/button.tsx`
- M `libraries/react-shared-libraries/src/form/color.picker.tsx`
- M `libraries/react-shared-libraries/src/form/input.tsx`
- M `libraries/react-shared-libraries/src/toaster/toaster.tsx`
- D `scripts/check-blueprint-css.cjs`
- A `apps/frontend/public/glass-icon.svg`
- A `apps/frontend/src/components/ui/glass-brand.tsx`
- A `apps/frontend/src/fonts/figtree/OFL.txt`
- A `apps/frontend/src/fonts/figtree/figtree-latin-ext-wght-normal.woff2`
- A `apps/frontend/src/fonts/figtree/figtree-latin-wght-normal.woff2`
- A `apps/frontend/src/fonts/figtree/figtree.font.ts`
- A `docs/GLASS_FRAME_COLOR_AUDIT.txt`
- A `docs/GLASS_FRAME_REPORT.md`
- A `scripts/check-glass-calendar.cjs`
- A `scripts/check-glass-css.cjs`
