// Render the production shell offline. No server, network or user requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const sass = require('sass');
const postcss = require('postcss');
const tailwind = require('tailwindcss');
const { chromium } = require('playwright');
const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/isoWeek'));
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/localizedFormat'));
let checks = 0;
const check = (condition, message) => {
  assert(condition, message);
  checks++;
};
const read = (file) => fs.readFileSync(file, 'utf8');
const helper = { exports: {}, process, URL };
vm.runInNewContext(
  ts.transpileModule(read('libraries/helpers/src/utils/base-path.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText,
  helper
);
function declarations(file, names, text = read(file)) {
  const source = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  return source.statements
    .filter(
      (node) =>
        (ts.isVariableStatement(node) &&
          node.declarationList.declarations.some((d) =>
            names.includes(d.name.getText(source))
          )) ||
        (ts.isFunctionDeclaration(node) &&
          names.includes(node.name?.getText(source)))
    )
    .map((node) => node.getText(source).replace(/^export\s+/, ''))
    .join('\n');
}
function components(file, names, bindings, text) {
  const sandbox = {
    React,
    ...React,
    URL,
    URLSearchParams,
    ...helper.exports,
    ...bindings,
  };
  vm.runInNewContext(
    ts.transpileModule(declarations(file, names, text), {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText + `\nresult = {${names.join(',')}};`,
    sandbox,
    { filename: file }
  );
  return sandbox.result;
}
let linkselfUrl = 'https://example.test';
let pathname = '/launches';
let user;
let integrationLoading = false;
let integrationError;
let integrationList;
let billingEnabled = false;
const identity = { username: 'creator', plan: 'Pro' };
const empty = () => null;
const pass = ({ children }) => children;
const calendar = {
  display: 'week',
  startDate: '2026-11-02',
  endDate: '2026-11-08',
  selectedDay: '2026-11-04',
  currentHour: dayjs('2026-11-04T12:00:00'),
  integrations: [{ id: 'channel', name: 'Channel' }],
  posts: [],
  postDates: new Map(),
  listPosts: [],
  sets: [],
  loading: false,
};
const shared = {
  clsx: require('clsx'),
  ...require('lodash'),
  dayjs,
  i18next: { resolvedLanguage: 'en' },
  newDayjs: (date) => dayjs(date || '2026-11-04T12:00:00'),
  fromUtc: dayjs,
  useVariables: () => ({
    linkselfUrl,
    frontEndUrl: 'https://example.test/dashboard/studio',
    billingEnabled,
  }),
  useUser: () => user,
  usePathname: () => pathname,
  useSearchParams: () => new URLSearchParams(),
  useT: () => (key, fallback) => fallback || key,
  useFetch: () => () => {
    throw new Error('No requests during server rendering');
  },
  useModals: () => ({ openModal() {} }),
  useCalendar: () => calendar,
  useEffect() {},
  usePendingNavigation: () => ({ pending: null, onNavigate() {} }),
  useDrop: () => [{ canDrop: false }, () => {}],
  useAddProvider: () => () => {},
  usePostActions: () => ({}),
  useLoadedPostDetails: () => () => () => {},
  Link: ({ prefetch, ...props }) => React.createElement('a', props),
};
const base = 'apps/frontend/src/components/';
const load = (file, names, bindings = {}) =>
  components(base + file + '.tsx', names, { ...shared, ...bindings });
const { GlassBrand } = load('ui/glass-brand', ['GlassBrand']);
const { Logo } = load('new-layout/logo', ['Logo'], { GlassBrand });
const { MenuItem } = load('new-layout/menu-item', ['MenuItem']);
const { Button } = components('libraries/react-shared-libraries/src/form/button.tsx', ['Button'], shared);
const { LogoutComponent } = load('layout/logout.component', [
  'LogoutComponent', 'StandaloneLogout',
], { Button, APP_NAME: 'LinkSelf Social' });
const { TopMenu } = load(
  'layout/top.menu',
  ['TopMenu', 'LinkSelfMenu', 'StandaloneTopMenu'],
  { MenuItem, LogoutComponent }
);
const { StudioTabs, studioPages, isStudioPage } = load('layout/studio.tabs', ['StudioTabs', 'studioPages', 'isStudioPage']);
const { Title } = load('layout/title', ['Title'], { studioPages, isStudioPage });
let organizations = [{ id: 'org', name: 'Workspace' }];
const { StreakComponent } = load('layout/streak.component', ['StreakComponent']);
const { OrganizationSelector } = load('layout/organization.selector', ['OrganizationSelector'], {
  useSWR: () => ({ data: organizations, isLoading: false }),
});
const { StudioPlaceholder } = load('layout/studio.placeholder', [
  'StudioPlaceholder',
]);
const { SourceAttribution } = load('auth/source-attribution', [
  'SourceAttribution',
]);
const { NotificationBell } = load('notifications/notification.component', [
  'NotificationBell',
]);
const NotificationComponent = () =>
  React.createElement(
    'div',
    { className: 'relative mobile:static' },
    React.createElement(
      'div',
      { className: 'glass-notification-target' },
      React.createElement(NotificationBell)
    )
  );
const { StudioHeader, SharePage } = load(
  'layout/studio.header',
  ['StudioHeader', 'SharePage'],
  { Title, NotificationBell, NotificationComponent, StreakComponent, OrganizationSelector, Button, useToaster: () => ({ show() {} }) }
);
const { NewPost } = load('launches/new.post', ['NewPost']);
const { WeekView, ScheduledPosts } = load(
  'launches/calendar',
  [
    'WeekView',
    'GlassWeekAgenda',
    'CalendarColumn',
    'ScheduledPosts',
    'channelColor',
    'hours',
  ],
  { NewPost, WeekNowLine: empty }
);
const { Filters } = load('launches/filters', ['Filters'], {
  SelectCustomer: empty,
  SelectChannels: empty,
  BottomSheet: empty,
});
const { LaunchesComponent } = load(
  'launches/launches.component',
  ['LaunchesComponent', 'useChannelGroups', 'ChannelsButton'],
  {
    StudioPlaceholder,
    Filters,
    ScheduledPosts,
    NewPost,
    Calendar: WeekView,
    useIntegrationList: () => ({
      data: integrationList || calendar.integrations,
      error: integrationError,
      isLoading: integrationLoading,
      mutate() {},
    }),
    useRouter: () => ({}),
    useToaster: () => ({}),
    useFireEvents: () => () => {},
    useCookie: () => ['0', () => {}],
    useDragDropManager: () => ({}),
    DNDProvider: pass,
    CalendarWeekProvider: pass,
    Onboarding: empty,
    ChannelsAfterPayment: empty,
    HubspotInstalled: empty,
    ImageWithFallback: empty,
  }
);
let providerCalls = 0;
const provider = ({ children }) => {
  providerCalls++;
  return children;
};
const { LayoutComponent, LayoutFrame } = load(
  'new-layout/layout.component',
  ['LayoutComponent', 'LayoutFrame'],
  {
    Logo,
    TopMenu,
    Title,
    StudioTabs,
    StudioPlaceholder,
    StudioHeader,
    SourceAttribution,
    jakartaSans: { className: '' },
    useSWR: () => ({ data: user }),
    ContextWrapper: provider,
    CopilotKit: provider,
    MantineWrapper: provider,
    CheckPayment: pass,
    ToolTip: empty,
    Toaster: empty,
    ShowMediaBoxModal: empty,
    ShowLinkedinCompany: empty,
    MediaSettingsLayout: empty,
    ShowPostSelector: empty,
    PreConditionComponent: empty,
    NewSubscription: empty,
    ContinueProvider: empty,
    AnnouncementBanner: empty,
    Support: empty,
  }
);
const render = (component, props) =>
  renderToStaticMarkup(React.createElement(component, props));
const head = (file) => require('node:child_process').execFileSync(
  'git', ['show', `HEAD:${file}`], { encoding: 'utf8' }
);
const standaloneBindings = {
  ...shared,
  useVariables: () => ({ linkselfUrl: '', isGeneral: true, billingEnabled: true }),
  Button,
  APP_NAME: 'LinkSelf Social',
  MenuItem,
};
const { useMenuItem } = components(base + 'layout/top.menu.tsx', ['useMenuItem'], standaloneBindings);
standaloneBindings.useMenuItem = useMenuItem;
const previousMode = linkselfUrl;
linkselfUrl = '';
for (const [file, name, currentNames, fixtures] of [
  ['layout/logout.component.tsx', 'LogoutComponent', ['LogoutComponent', 'StandaloneLogout'], [{}, { isIcon: true }]],
  ['layout/title.tsx', 'Title', ['Title', 'StandaloneTitle'], [{}]],
  ['layout/top.menu.tsx', 'TopMenu', ['TopMenu', 'StandaloneTopMenu'], [{}]],
]) {
  const current = components(base + file, currentNames, standaloneBindings)[name];
  const previous = components(base + file, [name], standaloneBindings, head(base + file))[name];
  for (const route of ['/launches', '/analytics', '/settings', '/plugs']) {
    pathname = route;
    user = { orgId: 'org', role: 'ADMIN', tier: 'PRO' };
    for (const props of fixtures)
      check(render(current, props) === render(previous, props), `${name}: standalone ${route} matches HEAD`);
  }
}
linkselfUrl = previousMode;
pathname = '/launches';
user = undefined;
const layoutFile = base + 'new-layout/layout.component.tsx';
const layoutBindings = {
  ...standaloneBindings,
  jakartaSans: { className: '' },
  useSWR: () => ({ data: user }),
  ContextWrapper: pass,
  CopilotKit: pass,
  MantineWrapper: pass,
  CheckPayment: pass,
};
for (const name of [
  'Logo', 'TopMenu', 'Title', 'StudioTabs', 'ToolTip', 'Toaster',
  'ShowMediaBoxModal', 'ShowLinkedinCompany', 'MediaSettingsLayout',
  'ShowPostSelector', 'PreConditionComponent', 'NewSubscription',
  'ContinueProvider', 'AnnouncementBanner', 'Support', 'Impersonate',
  'FirstBillingComponent', 'StreakComponent', 'OrganizationSelector',
  'InvoicesComponent', 'ModeComponent', 'LanguageComponent',
  'ChromeExtensionComponent', 'AttachToFeedbackIcon', 'NotificationComponent',
  'TrialTracker',
]) layoutBindings[name] = () => React.createElement('span', { 'data-widget': name });
const { LayoutComponent: currentStandalone } = components(layoutFile, ['LayoutComponent', 'LayoutFrame'], layoutBindings);
const { LayoutComponent: previousStandalone } = components(layoutFile, ['LayoutComponent'], layoutBindings, head(layoutFile));
for (const fixture of [undefined, { tier: 'PRO' }, { tier: 'FREE' }, { tier: 'PRO', admin: true }]) {
  user = fixture;
  check(render(currentStandalone, { children: 'Content' }) === render(previousStandalone, { children: 'Content' }), `Standalone frame matches HEAD for ${fixture?.admin ? 'admin' : fixture?.tier || 'loading'}`);
}
user = undefined;
const plainLogout = render(LogoutComponent);
const { StudioTabs: previousStudioTabs } = components(base + 'layout/studio.tabs.tsx', ['StudioTabs'], shared, head(base + 'layout/studio.tabs.tsx'));
for (const url of ['https://example.test', 'https://example.test/', 'https://other.test', 'https://other.test/root/']) {
  linkselfUrl = url;
  const campaignHref = (html) => html.match(/href="([^"]*\/dashboard\/campaigns)"/)[1];
  check(campaignHref(render(StudioTabs)) === campaignHref(render(previousStudioTabs)), `Campaigns keeps its HEAD destination for ${url}`);
}
linkselfUrl = previousMode;
check(plainLogout.includes('method="POST"') && plainLogout.includes('/api/auth/logout'), 'Labelled logout posts the LinkSelf form');
check(plainLogout.includes('glass-action') && plainLogout.includes('>Log out<') && !plainLogout.includes('<svg') && !plainLogout.includes('glass-rail-link'), 'Labelled logout uses the account action button without an icon');
let copiedUrl;
let toastMessage;
const { SharePage: CopySharePage } = load('layout/studio.header', ['SharePage'], {
  Button,
  copy: (url) => { copiedUrl = url; },
  useToaster: () => ({ show: (...args) => { toastMessage = args; } }),
});
const copyButton = CopySharePage({ username: identity.username }).props.children.find((node) => node?.type === Button);
copyButton.props.onClick();
check(copiedUrl === 'https://example.test/creator' && toastMessage[0] === 'Link copied to clipboard' && toastMessage[1] === 'success', 'Copy link uses the clipboard helper and success toast');
check(copyButton.props.children === 'Copy link', 'Copy link keeps its label after copying');

let pendingState = null;
const effects = [];
const listeners = new Map();
const { usePendingNavigation } = components(base + 'layout/navigation.highlight.ts', ['usePendingNavigation'], {
  usePathname: () => '/launches',
  useState: () => [pendingState, (value) => { pendingState = value; }],
  useEffect: (effect) => effects.push(effect),
  window: {
    addEventListener: (name, listener) => listeners.set(name, listener),
    removeEventListener: (name, listener) => { if (listeners.get(name) === listener) listeners.delete(name); },
  },
});
const navigation = usePendingNavigation();
const cleanups = effects.map((effect) => effect());
check(navigation.pending === null, 'Pending navigation starts empty');
const clickEvent = { button: 0, currentTarget: { target: '', hasAttribute: () => false } };
for (const ignored of [
  { defaultPrevented: true }, { button: 1 }, { button: 2 },
  ...['metaKey', 'ctrlKey', 'shiftKey', 'altKey'].map((modifier) => ({ [modifier]: true })),
  { currentTarget: { target: '_blank', hasAttribute: () => false } },
  { currentTarget: { target: '', hasAttribute: () => true } },
]) {
  pendingState = '/previous';
  navigation.onNavigate({ ...clickEvent, ...ignored }, '/next');
  check(pendingState === '/previous', `Pending navigation ignores ${Object.keys(ignored)[0]} ${ignored.button ?? ''}`);
}
navigation.onNavigate(clickEvent, '/next');
check(pendingState === '/next', 'Unmodified left click sets the pending path');
listeners.get('pageshow')();
check(pendingState === null, 'Pageshow clears the pending path');
cleanups.forEach((cleanup) => cleanup?.());
check(listeners.size === 0, 'Pending navigation removes the pageshow listener on unmount');
const first = render(LayoutComponent, { identity });
check(
  first.includes('glass-shell') &&
    first.includes('glass-rail') &&
    first.includes('glass-workspace-content') &&
    first.includes('glass-footer'),
  'Missing user renders the complete frame in server HTML'
);
check(
  first.includes('Calendar') &&
    first.includes('creator') &&
    first.includes('Pro'),
  'Title and display identity arrive in server HTML'
);
check(providerCalls === 0, 'Loading does not mount user providers');
check(
  !first.includes('spinner') && !first.includes('Loading'),
  'Loading tiles contain no visible loading copy or spinner'
);
check(
  first.includes('method="POST"') && first.includes('/api/auth/logout'),
  'Loading logout is a native POST form'
);
check(
  first.includes('href="/" aria-label="LinkSelf home"'),
  'Logo links to LinkSelf home'
);
linkselfUrl = '';
check(
  render(LayoutComponent, { identity }) === '',
  'Standalone still renders nothing before the user arrives'
);
linkselfUrl = 'https://example.test';
for (const [route, title] of [
  ['/analytics', 'Post analytics'],
  ['/media', 'Media'],
  ['/settings', 'Settings'],
  ['/plugs', 'Settings'],
  ['/unknown', 'Studio'],
]) {
  pathname = route;
  const html = render(LayoutComponent, {});
  check(
    html.includes(`<h1>${title}</h1>`) &&
      html.includes('glass-page-placeholder'),
    `${route}: title and single empty tile`
  );
  check(
    !html.includes('glass-handle') &&
      !html.includes('glass-plan') &&
      !html.includes('View live page') &&
      !html.includes('Share your page'),
    `${route}: absent identity hides display controls`
  );
}
pathname = '/launches';
integrationLoading = true;
check(
  render(LaunchesComponent).includes('glass-launches-placeholder'),
  'Integration loading uses the shared calendar placeholder'
);
integrationLoading = false;
integrationError = new Error('Could not load the channel list');
integrationList = [];
const failedChannels = render(LaunchesComponent);
check(
  failedChannels.includes('glass-launches-placeholder') &&
    failedChannels.includes('Trying again') &&
    !failedChannels.includes('Connect a channel'),
  'A failed channel list says so and never reads as having no channels'
);
integrationList = undefined;
const failedRefresh = render(LaunchesComponent);
check(
  !failedRefresh.includes('glass-launches-placeholder'),
  'A failed refresh keeps the channels that are already loaded'
);
integrationError = undefined;
user = { email: 'fallback@example.test', tier: 'PRO' };
const loaded = render(LayoutComponent, {
  identity,
  children: React.createElement(LaunchesComponent),
});
user = { ...user, orgId: 'org', streakSince: '2026-11-01' };
organizations = [{ id: 'org', name: 'First workspace' }, { id: 'other', name: 'Second workspace' }];
const populatedHeader = render(StudioHeader, { identity, loaded: true });
check(populatedHeader.indexOf('data-tooltip-content=') < populatedHeader.indexOf('First workspace') && populatedHeader.indexOf('First workspace') < populatedHeader.indexOf('glass-notification-target'), 'Loaded header shows streak and workspaces before the bell');
check(!render(StudioHeader, { identity, loaded: false }).includes('First workspace'), 'Loading header does not mount user widgets');
user = { email: 'fallback@example.test', tier: 'PRO' };
organizations = [{ id: 'org', name: 'Workspace' }];
check(providerCalls === 3, 'Loaded state mounts all three user providers');
check(
  loaded.includes('glass-week-grid') && loaded.includes('Scheduled'),
  'Loaded fixture renders the real calendar'
);
check(
  first.includes('aria-label="creator, Pro plan">CR</span>'),
  'Avatar uses the display username and plan label'
);
billingEnabled = true;
user = { ...user, tier: 'FREE' };
check(
  render(LayoutComponent, { identity }).includes('glass-shell'),
  'A free user keeps the LinkSelf frame when standalone billing is configured'
);
billingEnabled = false;
user = { ...user, tier: 'PRO' };
check(
  render(LayoutComponent).includes(
    'aria-label="fallback@example.test">FA</span>'
  ),
  'Avatar keeps the email fallback without display identity'
);
const share = render(SharePage, { username: identity.username });
for (const choice of ['Copy link', 'X', 'Facebook', 'WhatsApp', 'QR code'])
  check(share.includes(`>${choice}<`), `Share offers ${choice}`);
check(
  share.includes('href="/dashboard/qr"') && !share.includes('<img'),
  'Share uses LinkSelf QR without a third-party image'
);
const reloading = read(base + 'launches/launches.component.tsx').match(
  /if \(isLoading \|\| reload \|\| \(linkselfUrl && channelsFailed\)\) \{([\s\S]*?)\n  \}/
)[1];
check(
  reloading.indexOf('<StudioPlaceholder calendar') >= 0 &&
    reloading.indexOf('<StudioPlaceholder calendar') <
      reloading.indexOf('<LoadingComponent'),
  'Both integration loading and reload choose the placeholder before the standalone spinner'
);
pathname = '/media';
user = undefined;
const otherLoading = render(LayoutComponent, { identity });
user = { email: 'fallback@example.test', tier: 'PRO' };
const otherLoaded = render(LayoutComponent, {
  identity,
  children: React.createElement(
    'div',
    { style: { height: 1600, flexShrink: 0 } },
    'Media content'
  ),
});
pathname = '/launches';
const css = sass.compile('apps/frontend/src/app/global.scss', {
  loadPaths: ['node_modules'],
  logger: { warn() {} },
}).css;
const root = postcss.parse(css);
const gate = 'html[data-linkself-theme=glass-frame]';
function declaration(selector, property, value) {
  let found;
  root.walkRules(`${gate} ${selector}`, (rule) => {
    if (rule.parent.type === 'root')
      rule.walkDecls(property, (decl) => {
        found = decl.value;
      });
  });
  check(found === value, `${selector} ${property}: ${found}`);
}
for (const [property, value] of Object.entries({
  position: 'sticky',
  top: '36px',
  'align-self': 'flex-start',
  height: 'calc(100dvh - 74px)',
}))
  declaration('.glass-rail', property, value);
for (const [property, value] of Object.entries({
  width: 'fit-content',
  'max-width': '100%',
  padding: '4px',
  gap: '4px',
  border: '1px solid var(--line)',
  'border-radius': 'var(--radius-pill)',
  background: 'var(--inset)',
  'overflow-x': 'auto',
}))
  declaration('.glass-studio-tabs', property, value);
declaration('.glass-calendar', 'user-select', 'none');
declaration(
  '#left-menu [aria-current=page]:hover',
  'background',
  'var(--button-hover)'
);

check(
  /html\[data-linkself-theme=['"]?glass-frame['"]?\]\s*\{[^}]*scrollbar-gutter:\s*stable/.test(css),
  'Pages with and without a scrollbar keep the same width'
);

async function main() {
  let response;
  const integrationBindings = {
    ...shared,
    useCallback: (fn) => fn,
    useFetch: () => async () => response,
    useSWR: (key, loader, options) => ({ loader, options }),
  };
  const integrationFile = base + 'launches/helpers/use.integration.list.tsx';
  const { useIntegrationList } = components(integrationFile, ['useIntegrationList'], integrationBindings);
  const { useIntegrationList: previousIntegrationList } = components(integrationFile, ['useIntegrationList'], integrationBindings, head(integrationFile));
  linkselfUrl = '';
  for (const ok of [false, true]) {
    response = { ok, json: async () => ok ? { integrations: [{ id: 'channel' }] } : { message: 'Request failed' } };
    const current = useIntegrationList();
    const previous = previousIntegrationList();
    const result = await current.loader('/integrations/list');
    check(JSON.stringify(result) === JSON.stringify(await previous.loader('/integrations/list')), `Standalone channel response ${ok} matches HEAD without rejection`);
    check(JSON.stringify(current.options) === JSON.stringify(previous.options), `Standalone channel response ${ok} keeps HEAD fallback and retry options`);
    if (!ok) check(JSON.stringify(result ?? current.options.fallbackData) === '[]', 'Failed standalone response falls back to an empty list');
  }
  linkselfUrl = 'https://example.test';
  response = { ok: false, json: async () => ({ message: 'Request failed' }) };
  await assert.rejects(useIntegrationList().loader('/integrations/list'), /Could not load the channel list/);
  check(true, 'Failed LinkSelf channel response rejects for retry');
  const font = fs
    .readFileSync(
      'apps/frontend/src/fonts/figtree/figtree-latin-wght-normal.woff2'
    )
    .toString('base64');
  const config = require('../apps/frontend/tailwind.config.cjs');
  const styles = (
    await postcss([
      tailwind({
        ...config,
        content: [{ raw: first + loaded, extension: 'html' }],
      }),
    ]).process(css, { from: undefined })
  ).css;
  const doc = (html) =>
    `<!doctype html><html data-linkself-theme="glass-frame"><head><style>html[data-linkself-theme]{scrollbar-gutter:auto !important}@font-face{font-family:fixture;src:url(data:font/woff2;base64,${font});font-weight:100 900}html{--font-figtree:fixture}${styles}</style></head><body>${html}</body></html>`;
  const temp = fs.mkdtempSync(path.join(process.cwd(), '.glass-shell-'));
  const originalTmp = process.env.TMPDIR;
  process.env.TMPDIR = path.relative(process.cwd(), temp);
  let browser;
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        (fs.existsSync(chromium.executablePath())
          ? chromium.executablePath()
          : '/opt/google/chrome/chrome'),
      env: {
        ...process.env,
        XDG_CONFIG_HOME: path.join(temp, 'config'),
        XDG_CACHE_HOME: path.join(temp, 'cache'),
      },
    });
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
    for (const [width, height] of [
      [1515, 1000],
      [1100, 800],
      [768, 900],
      [390, 800],
    ]) {
      await page.setViewportSize({ width, height });
      const geometries = [];
      for (const html of [first, loaded]) {
        await page.setContent(doc(html));
        await page.evaluate(async () => {
          await document.fonts.ready;
          window.scrollTo(0, 0);
        });
        geometries.push(
          await page.evaluate(() => {
            const rect = (selector) => {
              const node = document.querySelector(selector),
                r = node.getBoundingClientRect();
              return [r.x, r.y, r.width, r.height].map(
                (v) => Math.round(v * 100) / 100
              );
            };
            return Object.fromEntries([
              ...[
                '.glass-shell',
                '.glass-rail',
                '.glass-brand',
                '.glass-rail-primary',
                '.glass-rail-bottom',
                '.glass-topbar',
                '.glass-title h1',
                '.glass-studio-tabs',
                '.glass-workspace-content',
                '.glass-calendar-panel',
                '.glass-calendar',
                '.glass-schedule',
                '.glass-footer',
                '.glass-handle',
                '.glass-plan',
                '.glass-header-actions',
                '.glass-header-actions > a',
                '.glass-share-button',
                '.glass-notification-target',
                '.glass-studio-tabs > a:first-child',
                '.glass-studio-tabs > a:nth-child(2)',
              ].map((s) => [s, rect(s)]),
              ['scrollHeight', document.documentElement.scrollHeight],
              ['scrollWidth', document.documentElement.scrollWidth],
              [
                'primaryItems',
                [
                  ...document.querySelectorAll(
                    '.glass-rail-primary .glass-rail-link'
                  ),
                ].map((n) => {
                  const r = n.getBoundingClientRect();
                  return [r.x, r.y, r.width, r.height];
                }),
              ],
              [
                'avatarVisible',
                document.querySelector('.glass-avatar').getBoundingClientRect()
                  .height > 0,
              ],
            ]);
          })
        );
      }
      if (process.env.GLASS_LAYOUT_DEBUG)
        console.log(width, JSON.stringify(geometries));
      const [initial, final] = geometries;
      // Position and width never move. A height may only differ once its bottom
      // edge is below the window, where nobody can see it. The toolbar in this
      // fixture is narrower than the real one, so the inside of the panel, which
      // draws nothing while loading, is compared in the real build instead.
      for (const selector of [
        '.glass-shell',
        '.glass-calendar-panel',
        '.glass-workspace-content',
        '.glass-footer',
        '.glass-topbar',
        '.glass-notification-target',
        '.glass-header-actions > a',
        '.glass-share-button',
      ]) {
        const [a, b] = [initial[selector], final[selector]];
        const offScreen = (r) => r[1] + r[3] >= height;
        check(
          a[0] === b[0] &&
            a[2] === b[2] &&
            (a[1] === b[1] || (offScreen(a) && offScreen(b))) &&
            (a[3] === b[3] ||
              (offScreen(a) && offScreen(b)) ||
              (selector === '.glass-calendar-panel' && width < 1000)),
          `${width}: ${selector} stays fixed on screen when loading finishes`
        );
      }
      check(
        initial['.glass-schedule'][0] === final['.glass-schedule'][0] &&
          initial['.glass-schedule'][2] === final['.glass-schedule'][2] &&
          (width < 1000 ||
            JSON.stringify(initial['.glass-schedule']) ===
              JSON.stringify(final['.glass-schedule'])),
        `${width}: the Scheduled tile stays fixed when loading finishes`
      );
      check(
        initial.scrollHeight === final.scrollHeight ||
          (initial.scrollHeight > height && final.scrollHeight > height),
        `${width}: the page only changes length below the window`
      );
      check(
        initial.scrollWidth <= width && final.scrollWidth <= width,
        `${width}: no sideways page scrolling with a stable scrollbar gutter`
      );
      check(await page.evaluate(() => { window.scrollTo(100, 0); return window.scrollX; }) === 0, `${width}: the viewport cannot scroll sideways`);
      const close = (actual, expected) =>
        actual.every((n, index) => Math.abs(n - expected[index]) < 0.6);
      const phone = width <= 760;
      check(
        close(
          initial['.glass-rail'],
          phone ? [25, 25, 340, 114] : [37, 37, 72, height - 74]
        ),
        `${width}: rail matches the reference`
      );
      check(
        close(
          initial['.glass-brand'],
          phone ? [27, 27, 36, 36] : [55, 39, 36, 36]
        ),
        `${width}: logo matches the reference`
      );
      check(
        close(
          initial['.glass-rail-primary'],
          phone ? [27, 71, 336, 66] : [39, 87, 68, 322]
        ),
        `${width}: primary group matches the reference`
      );
      check(
        close(
          initial['.glass-rail-bottom'],
          phone ? [283, 27, 80, 36] : [39, height - 217, 68, 178]
        ),
        `${width}: bottom group stays tied to the viewport`
      );
      initial.primaryItems.forEach((r, i) =>
        check(
          close(
            r,
            phone ? [32 + i * 65.2, 76, 65.2, 56] : [44, 92 + i * 64, 58, 56]
          ),
          `${width}: rail item ${i + 1} matches the reference`
        )
      );
      check(
        initial.avatarVisible === !phone,
        `${width}: avatar visibility matches the reference`
      );
      check(
        close(
          initial['.glass-topbar'],
          phone ? [25, 151, 340, 81] : [129, 37, width - 166, 38]
        ),
        `${width}: header matches the reference`
      );
      check(
        close(
          initial['.glass-studio-tabs'],
          phone ? [25, 248, 340, 48] : [129, 91, 450, 48]
        ),
        `${width}: tabs match the reference`
      );
      check(
        close(initial['.glass-workspace-content'].slice(0, 3), [
          phone ? 25 : 129,
          phone ? 312 : 155,
          phone ? 340 : width - 166,
        ]),
        `${width}: content matches the reference`
      );
      check(
        initial['.glass-workspace-content'][3] >= (phone ? 600 : height - 256),
        `${width}: content fills the window down to the footer`
      );
      check(
        Math.abs(
          initial['.glass-calendar-panel'][1] +
            initial['.glass-calendar-panel'][3] -
            (width < 1000
              ? initial['.glass-schedule'][1] - 12
              : initial['.glass-workspace-content'][1] +
                initial['.glass-workspace-content'][3])
        ) < 1,
        `${width}: the calendar panel leaves no gap below it`
      );
      check(
        initial['.glass-notification-target'][2] === 38 &&
          initial['.glass-notification-target'][3] === 38,
        `${width}: bell has a 38px target`
      );
      if (width === 1515) {
        check(
          close(initial['.glass-header-actions > a'], [1267, 37, 119, 38]),
          'View live page matches the reference'
        );
        check(
          close(initial['.glass-share-button'], [1393, 37, 85, 38]),
          'Share matches the reference'
        );
        check(
          close(
            initial['.glass-studio-tabs > a:first-child'],
            [134, 96, 80, 38]
          ),
          'Calendar tab matches the reference'
        );
        check(
          close(
            initial['.glass-studio-tabs > a:nth-child(2)'],
            [218, 96, 111, 38]
          ),
          'Analytics tab matches the reference'
        );
        check(
          close(
            initial['.glass-title h1'].slice(1).filter((_, i) => i !== 1),
            [43, 27]
          ),
          'Title line matches the reference'
        );
        check(
          Math.round(initial['.glass-handle'][1]) === 45 &&
            initial['.glass-plan'][1] === 40.5 &&
            initial['.glass-plan'][3] === 31,
          'Handle and plan align with the title'
        );
      }
      if (phone)
        check(
          initial['.glass-header-actions'][1] === 194,
          'Phone header actions start on the second line'
        );
      if (!phone) {
        await page.evaluate(() => window.scrollTo(0, 200));
        check(
          await page
            .locator('.glass-rail')
            .evaluate((n) => Math.abs(n.getBoundingClientRect().y - 36) < 1.1),
          `${width}: rail remains sticky on scroll`
        );
      }
    }
    for (const width of [1515, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const layouts = [];
      for (const html of [otherLoading, otherLoaded]) {
        await page.setContent(doc(html));
        await page.evaluate(async () => {
          await document.fonts.ready;
          window.scrollTo(0, 0);
        });
        layouts.push(
          await page.evaluate(() => {
            const slot = document.querySelector('.glass-workspace-content');
            return {
              frame: document
                .querySelector('.glass-shell')
                .getBoundingClientRect().height,
              footer: document
                .querySelector('.glass-footer')
                .getBoundingClientRect().y,
              tabs: document
                .querySelector('.glass-studio-tabs')
                .getBoundingClientRect().y,
              slotTop: slot.getBoundingClientRect().y,
              slotWidth: slot.getBoundingClientRect().width,
              scroll: document.documentElement.scrollHeight,
              viewport: window.innerHeight,
              contentScrolls:
                slot.scrollHeight > slot.clientHeight &&
                getComputedStyle(slot).overflowY === 'auto',
            };
          })
        );
      }
      for (const property of ['tabs', 'slotTop', 'slotWidth'])
        check(
          layouts[0][property] === layouts[1][property],
          `${width}: other routes keep ${property} stable when content arrives`
        );
      check(
        layouts[0].footer >= layouts[0].viewport - 120,
        `${width}: other routes keep the footer at the window bottom while loading`
      );
      check(
        !layouts[1].contentScrolls && layouts[1].scroll > layouts[1].viewport,
        `${width}: long content grows the page, with no scrollbar inside the page`
      );
      check(
        layouts[1].frame > layouts[0].frame && layouts[1].footer > layouts[0].footer,
        `${width}: long content pushes the footer down with the page`
      );
    }
    await page.setViewportSize({ width: 1515, height: 1000 });
    await page.setContent(doc(loaded));
    await page.evaluate(() => window.scrollTo(0, 0));
    const browserCode = [
      "const React = require('react'); const {useEffect, useState, useRef} = React;",
      "const {createRoot} = require('react-dom/client'); const {flushSync} = require('react-dom');",
      "const clsx = require('clsx');",
      `const useVariables = () => ({linkselfUrl: 'https://example.test', frontEndUrl: 'https://example.test/dashboard/studio'});
       let pathname = '/launches';
       const usePathname = () => pathname;
       const useSearchParams = () => new URLSearchParams();
       const useUser = () => ({email: 'fallback@example.test'});
       const Link = ({prefetch, ...props}) => React.createElement('a', props);
       const LogoutComponent = () => null;`,
      declarations('libraries/helpers/src/utils/base-path.ts', ['normalizedOrigin', 'linkselfPath']),
      declarations(base + 'layout/navigation.highlight.ts', ['usePendingNavigation']),
      declarations(base + 'new-layout/menu-item.tsx', ['MenuItem']),
      declarations(base + 'layout/top.menu.tsx', ['LinkSelfMenu']),
      declarations(base + 'layout/studio.tabs.tsx', ['StudioTabs', 'studioPages', 'isStudioPage']),
      `const rail = document.querySelector('#left-menu');
       const tabs = document.querySelector('.glass-studio-tabs');
       const slot = document.createElement('div'); tabs.replaceWith(slot);
       const railRoot = createRoot(rail); const tabsRoot = createRoot(slot);
       const renderNavigation = () => flushSync(() => {
         railRoot.render(React.createElement(LinkSelfMenu, {linkselfUrl: 'https://example.test'}));
         tabsRoot.render(React.createElement(StudioTabs));
       });
       renderNavigation();
       window.changeRoute = (path) => {pathname = path; renderNavigation();};
       window.addEventListener('click', e => e.preventDefault());`,
    ].join('\n');
    const bundle = await require('esbuild').build({
      stdin: { contents: browserCode, loader: 'tsx', resolveDir: process.cwd() },
      bundle: true,
      write: false,
      platform: 'browser',
      define: { 'process.env.NODE_ENV': '"development"' },
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    const active = page.locator('#left-menu [aria-current="page"]');
    await active.hover();
    const hovered = await active.evaluate((n) => ({
      color: getComputedStyle(n).backgroundColor,
      hover: n.matches(':hover'),
      token: getComputedStyle(n).getPropertyValue('--button-hover'),
    }));
    check(
      hovered.color === 'rgb(101, 177, 255)',
      `Current rail item keeps the LinkSelf active hover color: ${JSON.stringify(
        hovered
      )}`
    );
    await page.mouse.move(0, 0);
    for (const selector of ['#left-menu', '.glass-studio-tabs']) {
      const activeStyle = await page.locator(`${selector} [aria-current="page"]`).evaluate((node) => {
        const style = getComputedStyle(node);
        return [style.backgroundColor, style.color, style.borderRadius, style.boxShadow, style.fontWeight];
      });
      const destination = page
        .locator(selector === '#left-menu' ? `${selector} a` : `${selector} a[href="/dashboard/campaigns"]`)
        .first();
      for (const modifier of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) {
        await destination.evaluate(
          (n, modifier) =>
            n.dispatchEvent(
              new MouseEvent('click', {
                bubbles: true,
                cancelable: true,
                [modifier]: true,
              })
            ),
          modifier
        );
        check(
          (await page.locator('[data-navigation-pending]').count()) === 0,
          `${selector}: ${modifier} click preserves current selection`
        );
      }
      await destination.evaluate((n) =>
        n.dispatchEvent(
          new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            button: 1,
          })
        )
      );
      check(
        (await page.locator('[data-navigation-pending]').count()) === 0,
        `${selector}: middle click preserves current selection`
      );
      await destination.evaluate((n) =>
        n.dispatchEvent(
          new MouseEvent('click', { bubbles: true, cancelable: true })
        )
      );
      check(
        (await destination.evaluate(
          (n) => getComputedStyle(n).backgroundColor
        )) === 'rgb(47, 149, 255)',
        `${selector}: departing destination turns azure immediately`
      );
      check(JSON.stringify(await destination.evaluate((node) => {
        const style = getComputedStyle(node);
        return [style.backgroundColor, style.color, style.borderRadius, style.boxShadow, style.fontWeight];
      })) === JSON.stringify(activeStyle), `${selector}: pending selection has the exact active appearance`);
      check(
        (await page
          .locator(`${selector} [aria-current="page"]`)
          .evaluate((n) => getComputedStyle(n).backgroundColor)) ===
          'rgba(0, 0, 0, 0)',
        `${selector}: previous selection drops its highlight`
      );
      check(
        (await destination.getAttribute('aria-current')) === null,
        `${selector}: pending highlight never changes aria-current`
      );
      await destination.hover();
      check(
        (await destination.evaluate(
          (n) => getComputedStyle(n).backgroundColor
        )) ===
          (selector === '#left-menu'
            ? 'rgb(101, 177, 255)'
            : 'rgb(47, 149, 255)'),
        `${selector}: pending selection keeps the active hover style`
      );
      await page.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent('pageshow', { persisted: true })
        )
      );
      await page.waitForFunction(() => !document.querySelector('[data-navigation-pending]'));
      check(
        (await page.locator('[data-navigation-pending]').count()) === 0,
        `${selector}: pageshow clears pending selection after Back`
      );
      await page.mouse.move(0, 0);
      check(
        (await page
          .locator(`${selector} [aria-current="page"]`)
          .evaluate((n) => getComputedStyle(n).backgroundColor)) ===
          'rgb(47, 149, 255)',
        `${selector}: pageshow restores the actual route highlight`
      );
      await page.locator(`${selector} [aria-current="page"]`).dispatchEvent('click');
      check(await page.locator(`${selector} [aria-current="page"]`).evaluate((node) => getComputedStyle(node).backgroundColor) === 'rgb(47, 149, 255)', `${selector}: clicking the current route keeps its active appearance`);
      await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pageshow')));
      await page.waitForFunction(() => !document.querySelector('[data-navigation-pending]'));
    }
    const localTab = page.locator('.glass-studio-tabs a[href="/analytics"]');
    await localTab.dispatchEvent('click');
    check(await localTab.evaluate((node) => getComputedStyle(node).backgroundColor) === 'rgb(47, 149, 255)', 'Local Studio links receive the pending active appearance');
    check(await page.locator('.glass-studio-tabs [aria-current="page"]').textContent() === 'Calendar', 'Local pending navigation keeps the current route announcement');
    await page.evaluate(() => window.changeRoute('/analytics'));
    await page.waitForFunction(() => !document.querySelector('[data-navigation-pending]'));
    check(await page.locator('.glass-studio-tabs [aria-current="page"]').textContent() === 'Post analytics', 'Completed client navigation clears pending state and selects the new route');
    const settingsLink = page.locator('#left-menu a[aria-label="Settings"]');
    await settingsLink.dispatchEvent('click');
    check(await settingsLink.evaluate((node) => getComputedStyle(node).backgroundColor) === 'rgb(47, 149, 255)', 'Bottom rail links receive the pending active appearance');
    check(await page.locator('#left-menu [aria-current="page"]').evaluate((node) => getComputedStyle(node).backgroundColor) === 'rgba(0, 0, 0, 0)', 'Bottom rail navigation clears the primary rail highlight');
    console.log(`Glass shell layout checks: ${checks} passed, 0 failed.`);
  } finally {
    if (browser) await browser.close();
    if (originalTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = originalTmp;
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
