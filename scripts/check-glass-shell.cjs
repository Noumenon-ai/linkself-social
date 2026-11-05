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
  const previous = components(base + file, currentNames, standaloneBindings, head(base + file))[name];
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
const { LayoutComponent: previousStandalone } = components(layoutFile, ['LayoutComponent', 'LayoutFrame'], layoutBindings, head(layoutFile));
for (const fixture of [undefined, { tier: 'PRO' }, { tier: 'FREE' }, { tier: 'PRO', admin: true }]) {
  user = fixture;
  check(render(currentStandalone, { children: 'Content' }) === render(previousStandalone, { children: 'Content' }), `Standalone frame matches HEAD for ${fixture?.admin ? 'admin' : fixture?.tier || 'loading'}`);
}
user = undefined;
const plainLogout = render(LogoutComponent);
const { StudioTabs: previousStudioTabs } = components(base + 'layout/studio.tabs.tsx', ['StudioTabs', 'studioPages', 'isStudioPage'], shared, head(base + 'layout/studio.tabs.tsx'));
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
  /html\[data-linkself-theme=['"]?glass-frame['"]?\]\s*\{[^}]*-webkit-font-smoothing:\s*antialiased/.test(css),
  'Text is smoothed the same way as on LinkSelf pages'
);
check(
  /html\[data-linkself-theme=['"]?glass-frame['"]?\]\s*\{[^}]*scrollbar-gutter:\s*stable/.test(css),
  'Pages with and without a scrollbar keep the same width'
);

async function checkCalendarLayout(page, doc, loaded) {
  const errors = [];
  const onError = error => errors.push(error.message);
  page.on('pageerror', onError);
  await page.setViewportSize({ width: 1515, height: 1000 });
  await page.setContent(doc(loaded));
  const names = ['CalendarItem', 'CalendarColumn', 'WeekView', 'GlassWeekAgenda', 'MonthView',
    'DayView', 'DaySlotColumn', 'slotDate', 'hours', 'channelColor', 'CopyDebug', 'OpenPost',
    'Statistics', 'Preview', 'Duplicate', 'DeletePost', 'ListView'];
  const code = `
    const React = require('react');
    const {useMemo, useCallback, useState, memo, Fragment} = React;
    const {createRoot} = require('react-dom/client');
    const {flushSync} = require('react-dom');
    const dayjs = require('dayjs');
    dayjs.extend(require('dayjs/plugin/isoWeek'));
    dayjs.extend(require('dayjs/plugin/utc'));
    dayjs.extend(require('dayjs/plugin/localizedFormat'));
    const {groupBy, sortBy} = require('lodash');
    const clsx = require('clsx');
    const i18next = {resolvedLanguage: 'en'};
    const newDayjs = (date) => dayjs(date || '2026-11-04T12:00:00');
    const fromUtc = dayjs;
    const isUSCitizen = () => false;
    const useNow = () => newDayjs();
    const useT = () => (_, fallback) => fallback;
    const useUser = () => ({isSuperAdmin: true});
    const useVariables = () => ({linkselfUrl: 'https://example.test'});
    const withBasePath = p => p;
    const stripHtmlValidation = (_, value) => value;
    const CalendarContext = React.createContext(null);
    let calendar;
    const useCalendar = () => React.useContext(CalendarContext) || calendar;
    const useDrop = () => [{canDrop: false}, () => {}];
    window.dragItems = [];
    const useDrag = factory => [{opacity: 1}, node => {
      if (node) {node.draggable = true; window.dragItems.push(factory().item);}
    }];
    window.calendarActions = [];
    const record = action => post => () => window.calendarActions.push([action, post?.id || post]);
    const usePostActions = () => ({editPost: (post, duplicate) => record(duplicate ? 'duplicate' : 'edit')(post),
      deletePost: record('delete'), copyDebugJson: record('debug'), openStatistics: record('statistics'),
      openMissingRelease: record('missing'), openPost: record('open')});
    const useLoadedPostDetails = () => record('details');
    const useModals = () => ({openModal: () => window.calendarActions.push(['create'])});
    const useFetch = () => () => {throw new Error('Unexpected request');};
    const useAddProvider = () => () => {};
    const WeekNowLine = () => null, DayNowLine = () => null;
    const AddEditModal = () => null, SetSelectionModal = () => null;
    const SafeImage = 'img', ChevronUpIcon = () => null;
    ${declarations(base + 'launches/calendar.tsx', names)}
    const root = createRoot(document.querySelector('.glass-calendar'));
    window.renderCalendar = (display, count = 1) => {
      const makePost = (id, hour, state = 'DRAFT') => ({id, group: id, content: 'A long draft caption that must stay on one line',
        publishDate: '2026-11-05T' + hour + ':00:00', state,
        tags: id === 'post0' ? [{tag: {name: 'Campaign', color: '#d45a73'}}] : [],
        integration: {id: 'channel', name: 'Channel', providerIdentifier: 'network'},
        releaseId: state === 'PUBLISHED' ? 'release' : null, error: 'Publishing failed'});
      const posts = Array.from({length: count}, (_, i) => makePost('post' + i, '13', i === 1 ? 'ERROR' : i === 2 ? 'PUBLISHED' : 'DRAFT'));
      posts.push(makePost('next', '14'));
      calendar = {display, startDate: display === 'week' ? '2026-11-02' : display === 'month' ? '2026-11-01' : '2026-11-05',
        selectedDay: '2026-11-05', currentHour: newDayjs().startOf('hour'), loading: false,
        integrations: [{id: 'channel', name: 'Channel', hasPostAnalytics: true, time: []}],
        posts, listPosts: posts, postDates: new Map(posts.map(p => [p, dayjs(p.publishDate)])),
        sets: [], setSelectedDay() {}, reloadCalendarView() {}};
      flushSync(() => root.render(React.createElement(display === 'week' ? WeekView : display === 'month' ? MonthView : display === 'list' ? ListView : DayView, {key: display + count})));
    };
    window.renderSingleChip = () => flushSync(() => root.render(React.createElement(CalendarItem, {
      display: 'day', date: newDayjs(), isBeforeNow: true, state: 'DRAFT', post: calendar.posts[0],
      integrations: calendar.integrations, editPost: record('edit')(calendar.posts[0]), showTime: true
    })));
    window.open = () => window.calendarActions.push(['preview']);
    window.renderCalendar('week');
  `;
  const bundle = await require('esbuild').build({stdin: {contents: code, loader: 'tsx', resolveDir: process.cwd()}, bundle: true, write: false, platform: 'browser'});
  await page.addScriptTag({content: bundle.outputFiles[0].text});
  const chipSelector = '.glass-week-desktop .glass-post-chip';
  const firstChip = page.locator(chipSelector).first();
  await firstChip.scrollIntoViewIfNeeded();
  await page.mouse.move(0, 0);
  const measure = (selector) => page.locator(selector).evaluateAll(nodes => nodes.map(n => {
    const r = n.getBoundingClientRect();
    return {top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height};
  }));
  let chips = await measure(chipSelector);
  const firstCell = await firstChip.evaluate(n => {
    const r = n.closest('.glass-calendar-cell').getBoundingClientRect();
    return {top: r.top, bottom: r.bottom, height: r.height};
  });
  check(chips.length === 2, 'Week renders posts in two adjacent hours');
  check(chips[0].height === 36, 'Week chip is 36px tall');
  check(chips[0].top >= firstCell.top && chips[0].bottom <= firstCell.bottom, 'Week chip fits fully inside its cell');
  check(firstCell.height === 44, 'One post fits a 44px week row');
  check(chips[0].bottom <= chips[1].top, 'Adjacent hour posts do not overlap');
  for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    check(await firstChip.evaluate((n, fraction) => {
      const r = n.getBoundingClientRect();
      return n.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height * fraction));
    }, fraction), `Week chip receives pointer hits at ${fraction * 100}% of its height`);
  }
  const emptyHeights = await page.locator('.glass-week-grid .glass-hour-label').evaluateAll(nodes => nodes.map(n => n.getBoundingClientRect().height));
  check(emptyHeights.every(h => h === 44), 'Empty week rows remain 44px');
  for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) {
    const before = await page.evaluate(() => window.calendarActions.length);
    await firstChip.click({position: {x: 12, y: chips[0].height * fraction}});
    check(await page.evaluate(before => window.calendarActions.length === before + 1 && window.calendarActions.at(-1)[0] === 'edit', before), `Clicking the chip at ${fraction * 100}% opens the editor`);
  }
  await page.mouse.move(0, 0);
  await firstChip.locator('.glass-chip-editor').evaluate(n => n.blur());
  check(await firstChip.locator('.glass-chip-actions').evaluate(n => getComputedStyle(n).opacity === '0'), 'Chip actions are hidden at rest');
  await firstChip.hover();
  check(await firstChip.locator('.glass-chip-actions').evaluate(n => getComputedStyle(n).opacity === '1'), 'Hover shows chip actions');
  check(JSON.stringify(await measure(chipSelector)) === JSON.stringify(chips), 'Hover leaves chip size and position unchanged');
  await firstChip.locator('.glass-chip-more').hover();
  check(await firstChip.locator('.glass-chip-actions button').evaluateAll(nodes => nodes.length >= 4 && nodes.every(n => {
    const r = n.getBoundingClientRect(); return r.width >= 24 && r.height >= 24;
  })), 'Chip action targets are at least 24px');
  check(await firstChip.locator('.glass-chip-action-list button').evaluateAll(nodes => nodes.every(n => {
    const r = n.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return !!hit && n.contains(hit);
  })), 'Every week chip action can be reached from the more button');
  check(await firstChip.locator('.glass-chip-actions').evaluate(n => getComputedStyle(n).backgroundColor === 'rgb(34, 46, 64)'), 'Chip actions have a solid background');
  await page.mouse.move(0, 0);
  await firstChip.locator('.glass-chip-editor').focus();
  check(await firstChip.locator('.glass-chip-actions').evaluate(n => getComputedStyle(n).opacity === '1'), 'Keyboard focus shows chip actions');
  await firstChip.locator('.glass-chip-editor').press('Enter');
  check(await page.evaluate(() => window.calendarActions.some(([action, id]) => action === 'edit' && id === 'post0')), 'Keyboard activation opens the post editor');
  await firstChip.locator('.glass-chip-more').hover();
  await firstChip.locator('[aria-label="Duplicate"]').click();
  check(await page.evaluate(() => window.calendarActions.some(([action, id]) => action === 'duplicate' && id === 'post0') && !window.calendarActions.some(([action]) => action === 'create')), 'Duplicate uses its action without opening Create Post');
  check(await firstChip.locator('.glass-chip-marker').evaluate(n => getComputedStyle(n).width === '3px' && getComputedStyle(n).backgroundColor === 'rgb(212, 90, 115)' && n.title === 'Campaign'), 'Tagged chip shows a 3px marker with its tag name');
  check(await page.locator(chipSelector).nth(1).locator('.glass-chip-marker').count() === 0, 'Untagged chip has no marker');
  check(await firstChip.locator('.glass-chip-text').evaluate(n => n.textContent.startsWith('Draft: ') && getComputedStyle(n).whiteSpace === 'nowrap' && getComputedStyle(n).textOverflow === 'ellipsis' && n.scrollWidth > n.clientWidth), 'Draft caption stays on one ellipsized line');
  check(await firstChip.evaluate(n => n.draggable) && await page.evaluate(() => window.dragItems.some(item => item.id === 'post0' && item.interval === false && item.date)), 'Chip remains connected to post dragging');
  await page.evaluate(() => window.renderCalendar('week', 3));
  await page.locator(chipSelector).first().scrollIntoViewIfNeeded();
  chips = await measure(chipSelector);
  check(chips.length === 4 && chips.every(c => c.height === 36), 'Three posts in one slot and the next hour all use 36px chips');
  for (let i = 0; i < chips.length - 1; i++) check(chips[i].bottom <= chips[i + 1].top, `Stacked post ${i + 1} does not overlap the following post`);
  const stackedCell = await page.locator(chipSelector).first().evaluate(n => {
    const r = n.closest('.glass-calendar-cell').getBoundingClientRect(); return {top: r.top, bottom: r.bottom, height: r.height};
  });
  check(stackedCell.height > 44 && chips.slice(0, 3).every(c => c.top >= stackedCell.top && c.bottom <= stackedCell.bottom), 'Week row grows to contain all three posts');
  check(stackedCell.bottom <= chips[3].top, 'Expanded slot ends before the next hour post');
  check(await page.locator('.glass-week-grid .glass-hour-label').evaluateAll(nodes => nodes.every((n, i) => i === 13 || n.getBoundingClientRect().height === 44)), 'Stacking posts leaves other empty rows at 44px');
  check(await page.locator(chipSelector).evaluateAll(nodes => nodes.every(n => {
    const r = n.getBoundingClientRect();
    const add = n.closest('.glass-calendar-cell').querySelector('.glass-slot-label').getBoundingClientRect();
    return add.height === 0 || add.top >= r.bottom || add.bottom <= r.top;
  })), 'Slot add areas never cover a stacked chip');
  for (let index = 0; index < 4; index++) {
    const chip = page.locator(chipSelector).nth(index);
    await chip.scrollIntoViewIfNeeded();
    for (const fraction of [0.1, 0.3, 0.5, 0.7, 0.9]) check(await chip.evaluate((n, fraction) => {
      const r = n.getBoundingClientRect();
      return n.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height * fraction));
    }, fraction), `Stacked chip ${index + 1} receives pointer hits at ${fraction * 100}%`);
  }
  const published = page.locator(`${chipSelector}[data-state="PUBLISHED"]`);
  for (const [label, action] of [['Copy Debug JSON', 'debug'], ['Statistics', 'statistics'], ['Preview', 'preview'], ['Delete', 'delete']]) {
    await published.locator('.glass-chip-more').focus();
    await published.locator(`[aria-label="${label}"]`).focus();
    await published.locator(`[aria-label="${label}"]`).press('Enter');
    check(await page.evaluate(action => window.calendarActions.at(-1)[0] === action, action), `${label} invokes its post action`);
  }
  for (const state of ['ERROR', 'PUBLISHED']) check(await page.locator(`${chipSelector}[data-state="${state}"]`).evaluate(n => {
    const r = n.getBoundingClientRect(), b = n.querySelector('.glass-chip-status').getBoundingClientRect();
    return b.height > 0 && b.top >= r.top && b.bottom <= r.bottom && b.left >= r.left && b.right <= r.right;
  }), `${state} badge stays inside the chip`);
  await page.evaluate(() => window.renderCalendar('week', 4));
  const more = page.locator('.glass-week-desktop').getByText('+ Show more (1)', {exact: true});
  await more.click();
  check(await page.locator(chipSelector).count() === 5, 'Show more reveals the remaining slot post');
  chips = await measure(chipSelector);
  check(chips.every((c, i) => !i || chips[i - 1].bottom <= c.top), 'Expanded posts do not overlap');
  await page.evaluate(() => window.renderCalendar('day', 3));
  const dayChips = await measure('.glass-day-view .glass-post-chip');
  check(dayChips.length === 4 && dayChips.every(c => c.height === 36), 'Day view renders compact chips');
  check(dayChips.every((c, i) => !i || dayChips[i - 1].bottom <= c.top), 'Day posts stack without overlap');
  await page.evaluate(() => window.renderCalendar('list', 3));
  const listChips = page.locator('.glass-list-view .glass-post-chip');
  check(await listChips.count() > 0, 'List view uses the same one-line chips');
  check(await page.locator('.glass-list-view .glass-post-bar').count() === 0, 'List view has no empty bar');
  check(await listChips.first().locator('.glass-chip-marker').evaluate(n => getComputedStyle(n).backgroundColor === 'rgb(212, 90, 115)'), 'A tagged list post shows the tag colour');
  check(await listChips.first().locator('.glass-chip-more').evaluate(n => getComputedStyle(n).display === 'none'), 'Wide list chips show their actions directly');
  const listCards = await measure('.glass-list-view .glass-post');
  check(listCards.every((c, i) => !i || listCards[i - 1].bottom <= c.top), 'List cards do not overlap');
  for (const width of [1515, 390]) {
    await page.setViewportSize({width, height: 1000});
    await page.evaluate(() => window.renderCalendar('month', 3));
    const tiles = await measure('.glass-month-grid .glass-date-tile');
    check(tiles.length === 42, `${width}: month renders all day tiles`);
    for (let row = 0; row < 6; row++) {
      const week = tiles.slice(row * 7, row * 7 + 7);
      check(week.every(tile => tile.height === week[0].height && tile.top === week[0].top), `${width}: month row ${row + 1} has aligned tiles of equal height`);
    }
    check(await page.locator('.glass-date-tile').evaluateAll(nodes => nodes.every(n => {
      const r = n.getBoundingClientRect(), p = n.parentElement.getBoundingClientRect();
      return r.top === p.top && r.bottom === p.bottom;
    })), `${width}: month tiles fill their grid cells`);
  }
  await page.setViewportSize({width: 1515, height: 1000});
  await page.evaluate(() => window.renderSingleChip());
  const timed = page.locator('.glass-post-chip');
  check(await timed.locator('.glass-chip-time').textContent() === '13:00', 'Compact chip displays the time when requested');
  check(await timed.evaluate(n => getComputedStyle(n).filter === 'grayscale(1)'), 'Past compact chips retain greyscale');
  check((await timed.boundingBox()).height === 36, 'Time and past styling keep the chip at 36px');
  page.off('pageerror', onError);
  check(errors.length === 0, `Calendar renders without browser errors: ${errors.join(', ')}`);
}

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
        content: [{ raw: first + loaded, extension: 'html' }, { raw: read(base + 'launches/calendar.tsx'), extension: 'tsx' }],
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
    await checkCalendarLayout(page, doc, loaded);
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
