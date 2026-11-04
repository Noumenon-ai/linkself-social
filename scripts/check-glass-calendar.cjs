// Exercise the actual calendar components without starting the app or a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const RealDate = Date;
const fixedNow = RealDate.parse('2026-11-04T19:00:00Z');
global.Date = class extends RealDate {
  constructor(...args) {
    super(...(args.length ? args : [fixedNow]));
  }
  static now() {
    return fixedNow;
  }
};
const dayjs = require('dayjs');
dayjs.extend(require('dayjs/plugin/utc'));
dayjs.extend(require('dayjs/plugin/isoWeek'));
dayjs.extend(require('dayjs/plugin/localizedFormat'));
let count = 0;
const check = (value, message) => {
  assert(value, message);
  count++;
};
// Compile the named declarations from the real TSX; dependencies are injected below.
function component(file, names, bindings) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const text = source.statements
    .filter(
      (statement) =>
        ts.isVariableStatement(statement) &&
        statement.declarationList.declarations.some((d) =>
          names.includes(d.name.getText(source))
        )
    )
    .map((statement) => statement.getText(source).replace(/^export\s+/, ''))
    .join('\n');
  const result = ts.transpileModule(text, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  });
  const sandbox = { exports: {}, React, Date: global.Date, ...bindings };
  vm.runInNewContext(
    result.outputText + `\nObject.assign(exports, {${names.join(',')}});`,
    sandbox,
    { filename: file }
  );
  return sandbox.exports;
}
const nodes = (node) =>
  !node || typeof node !== 'object'
    ? []
    : [node, ...React.Children.toArray(node.props?.children).flatMap(nodes)];
const text = (node) =>
  typeof node === 'string' || typeof node === 'number'
    ? String(node)
    : node && typeof node === 'object'
    ? React.Children.toArray(node.props?.children).map(text).join(' ')
    : '';
const timezoneFile = 'apps/frontend/src/components/layout/set.timezone.tsx';
const timezoneCode = ts.transpileModule(fs.readFileSync(timezoneFile, 'utf8'), {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
    esModuleInterop: true,
  },
}).outputText;
const timezone = {
  exports: {},
  require,
  Date: class extends Date {
    static now() {
      return Date.parse('2026-11-04T19:00:00Z');
    }
  },
};
vm.runInNewContext(timezoneCode, timezone, { filename: timezoneFile });
timezone.exports.setUserTimezone('America/New_York');
const { newDayjs, fromUtc } = timezone.exports;
const now = () => newDayjs();
check(now().valueOf() === fixedNow && dayjs().valueOf() === fixedNow, 'Calendar helpers and dayjs share the fixed clock, independent of time of day');
const integrations = [
  { id: 'a', name: 'Channel A' },
  { id: 'b', name: 'Channel B' },
];
let calendar = {
  posts: [],
  listPosts: [],
  display: 'month',
  selectedDay: '2026-11-04',
  startDate: '2026-11-01',
  integrations,
  loading: false,
  setSelectedDay: (day) => {
    calendar.selectedDay = day;
  },
};
let linkselfUrl = 'https://example.test';
const NewPostStub = () => null;
const { ScheduledPosts } = component(
  'apps/frontend/src/components/launches/calendar.tsx',
  ['channelColor', 'ScheduledPosts'],
  {
    useVariables: () => ({ linkselfUrl }),
    useCalendar: () => calendar,
    useLoadedPostDetails: () => () => () => {},
    useT: () => (_, fallback) => fallback,
    useAddProvider: () => () => {},
    useMemo: (f) => f(),
    newDayjs,
    fromUtc,
    stripHtmlValidation: (_, value) => value,
    NewPost: NewPostStub,
  }
);
const post = (id, date, channel = 'a') => ({
  id,
  publishDate: date,
  content: `Post ${id}`,
  state: 'QUEUE',
  integration: {
    id: channel,
    name: `Channel ${channel}`,
    providerIdentifier: 'network',
  },
});
calendar.posts = [
  post('late', '2026-11-04T23:00:00Z'),
  post('early', '2026-11-04T06:00:00Z', 'b'),
  post('yesterday', '2026-11-04T02:00:00Z'),
  post('tomorrow', '2026-11-05T06:00:00Z'),
];
let tree = ScheduledPosts();
check(
  text(tree).includes('Post late') && text(tree).includes('Post early'),
  'Selected day includes loaded posts'
);
check(
  !text(tree).includes('Post yesterday') &&
    !text(tree).includes('Post tomorrow'),
  'Date filtering uses the user timezone'
);
check(
  text(tree).indexOf('Post early') < text(tree).indexOf('Post late'),
  'Events sorted chronologically'
);
check(
  nodes(tree).filter((n) => n.type === 'article').length === 2,
  'Only matching loaded posts are rendered'
);
check(
  nodes(tree).filter((n) => n.type === 'article')[0].props.style[
    '--event-color'
  ] === 'var(--coral)',
  'Channel tick color stable by integration'
);
check(text(tree).includes('Scheduled'), 'Real post status is shown');
nodes(tree)
  .find((n) => n.type === 'input')
  .props.onChange({ target: { value: '2026-11-06' } });
tree = ScheduledPosts();
check(
  text(tree).includes('No loaded posts for this day.'),
  'Unloaded day has a real empty state'
);
check(
  nodes(tree).some((n) => n.type === NewPostStub),
  'Empty state offers editor action'
);
calendar.selectedDay = '2026-11-04';
calendar.posts = [];
tree = ScheduledPosts();
check(
  nodes(tree)
    .find((n) => n.type === NewPostStub)
    .props.date.isAfter(now()),
  'Today empty action never schedules in the past'
);
calendar.loading = true;
tree = ScheduledPosts();
check(
  nodes(tree).some((n) => n.props.role === 'status'),
  'Loading uses a placeholder'
);
check(
  !text(tree).includes('No loaded posts'),
  'Loading does not show a false empty state'
);
calendar.loading = false;
calendar.display = 'list';
calendar.listPosts = [post('list', '2026-11-04T06:00:00Z')];
check(
  text(ScheduledPosts()).includes('Post list'),
  'List view reads already loaded list posts'
);
calendar.display = 'day';
calendar.startDate = '2026-11-05';
calendar.posts = [post('day', '2026-11-05T06:00:00Z')];
check(
  text(ScheduledPosts()).includes('Post day'),
  'Day view follows its displayed date'
);
linkselfUrl = '';
check(ScheduledPosts() === null, 'Upstream has no schedule column');

// Execute the real provider's state transitions; SWR is stubbed so no network is used.
const contextFile =
  'apps/frontend/src/components/launches/calendar.context.tsx';
const dateHelpers = component(
  contextFile,
  ['getDateRange', 'selectedDayForRange'],
  { newDayjs }
);
let states = [];
let cursor = 0;
let initialParams = new URLSearchParams();
const queryKeys = [];
const { CalendarWeekProvider } = component(
  contextFile,
  ['CalendarWeekProvider'],
  {
    ...dateHelpers,
    newDayjs,
    fromUtc,
    URLSearchParams,
    useState: (initial) => {
      const index = cursor++;
      if (!(index in states))
        states[index] = typeof initial === 'function' ? initial() : initial;
      return [
        states[index],
        (next) => {
          states[index] =
            typeof next === 'function' ? next(states[index]) : next;
        },
      ];
    },
    useEffect: () => {},
    useCallback: (f) => f,
    useMemo: (f) => f(),
    useFetch: () => () => {
      throw new Error('Provider checks must not fetch');
    },
    useSearchParams: () => initialParams,
    useCookie: () => ['week', () => {}],
    useSWR: (key) => {
      queryKeys.push(key);
      return { mutate: () => {}, isLoading: false };
    },
    useNow: () => now().startOf('hour'),
    CalendarContext: { Provider: 'provider' },
    window: {
      matchMedia: () => ({ matches: false }),
      history: { replaceState: () => {} },
    },
  }
);
const renderProvider = () => {
  cursor = 0;
  calendar = CalendarWeekProvider({ children: null, integrations }).props.value;
  return calendar;
};
const setRange = (display, date) => {
  calendar.setFilters({
    ...dateHelpers.getDateRange(display, date),
    display,
    customer: null,
  });
  renderProvider();
};
const { Filters } = component(
  'apps/frontend/src/components/launches/filters.tsx',
  ['Filters'],
  {
    useCalendar: () => calendar,
    useVariables: () => ({ linkselfUrl }),
    useT: () => (_, fallback) => fallback,
    useState: () => [false, () => {}],
    useCallback: (f) => f,
    newDayjs,
    dayjs,
    i18next: {},
    getDateRange: dateHelpers.getDateRange,
    clsx: require('clsx'),
    SelectCustomer: 'select-customer',
    SelectChannels: 'select-channels',
    FilterIcon: 'filter-icon',
    BottomSheet: 'bottom-sheet',
  }
);
linkselfUrl = 'https://example.test';
renderProvider();
const heading = () => text(nodes(Filters()).find((n) => n.type === 'h2'));
for (const display of ['day', 'week', 'month']) {
  setRange(display, '2026-11-04');
  const before = heading();
  check(
    calendar.selectedDay === '2026-11-04',
    `${display}: today selected inside visible range`
  );
  const arrows = nodes(Filters()).filter((n) =>
    n.props.className?.includes('glass-calendar-arrow')
  );
  check(
    arrows.length === 2 &&
      arrows.every((n) => n.props.className.includes('rtl:rotate-180')),
    `${display}: both arrows reverse in RTL`
  );
  arrows.find((n) => n.props['aria-label'] === 'Next').props.onClick();
  renderProvider();
  check(
    calendar.selectedDay === calendar.startDate,
    `${display}: next range selects its first day`
  );
  check(heading() !== before, `${display}: next visibly changes heading`);
  nodes(Filters())
    .find((n) => n.props['aria-label'] === 'Previous')
    .props.onClick();
  renderProvider();
  check(
    calendar.selectedDay === '2026-11-04',
    `${display}: previous range restores today`
  );
  check(heading() === before, `${display}: previous restores heading`);
  setRange(display, '2026-11-04');
  const picked = '2027-01-17';
  nodes(ScheduledPosts())
    .find((n) => n.type === 'input')
    .props.onChange({ target: { value: picked } });
  renderProvider();
  check(
    calendar.selectedDay === picked &&
      calendar.startDate <= picked &&
      calendar.endDate >= picked,
    `${display}: date input selects and loads picked range`
  );
  check(
    queryKeys.some(
      (key) =>
        key?.startsWith('/posts-') &&
        key.includes(`startDate=${calendar.startDate}`)
    ),
    `${display}: picked range changes SWR query`
  );
  const scheduled = ScheduledPosts();
  check(
    nodes(scheduled).find((n) => n.type === 'input').props.value === picked,
    `${display}: input reflects picked day`
  );
  check(
    nodes(scheduled)
      .find((n) => n.type === NewPostStub)
      .props.date.format('YYYY-MM-DD') === picked,
    `${display}: New Post keeps picked day`
  );
}
setRange('month', '2026-10-01');
calendar.setSelectedDay('2026-10-10');
renderProvider();
check(
  nodes(ScheduledPosts())
    .find((n) => n.type === NewPostStub)
    .props.date.format('YYYY-MM-DD') === '2026-10-10',
  'Past selected day is not silently replaced with today'
);
setRange('list', '2026-11-04');
calendar.setSelectedDay('2027-02-03');
renderProvider();
check(
  calendar.display === 'day' && calendar.startDate === '2027-02-03',
  'Picking a day from paginated list switches to a date-bound query'
);
initialParams = new URLSearchParams(
  'display=month&startDate=2027-03-01&endDate=2027-03-31'
);
states = [];
renderProvider();
check(
  calendar.selectedDay === '2027-03-01',
  'Deep-linked ranges initialize Scheduled inside the range'
);
setRange('week', '2026-11-04');
check(
  heading().includes('11/02/2026') && heading().includes('11/08/2026'),
  'Week heading includes both actual endpoints'
);
setRange('day', '2026-11-04');
check(heading().includes('11/04/2026'), 'Day heading includes actual date');

// Month ticks preserve status information and consume pointer/keyboard activation.
let detailOpens = 0;
let dropSpec;
let dropDialog;
let dropChoice = 'schedule';
const dropRequests = [];
const { CalendarItem, CalendarColumn } = component(
  'apps/frontend/src/components/launches/calendar.tsx',
  ['channelColor', 'CalendarItem', 'CalendarColumn'],
  {
    memo: (f) => f,
    useMemo: (f) => f(),
    useCallback: (f) => f,
    useState: () => [false, () => {}],
    useT: () => (_, fallback) => fallback,
    useCalendar: () => calendar,
    useVariables: () => ({ linkselfUrl }),
    useLoadedPostDetails: () => () => () => {
      detailOpens++;
    },
    useUser: () => ({}),
    useDrag: () => [{ opacity: 1 }, () => {}],
    useDrop: (factory) => {
      dropSpec = factory();
      return [{ canDrop: false }, () => {}];
    },
    usePostActions: () => ({}),
    useModals: () => ({
      openModal: (dialog) => {
        dropDialog = dialog;
        if (dropChoice === 'cancel') return dialog.onClose();
        nodes(dialog.children)
          .find(
            (n) =>
              n.type === 'button' &&
              text(n) ===
                (dropChoice === 'update'
                  ? 'Just update the post details'
                  : 'Reschedule the post')
          )
          .props.onClick();
      },
      closeAll: () => {},
    }),
    useFetch: () => async (url, options) => {
      dropRequests.push({ url, ...options, body: JSON.parse(options.body) });
      return { status: 200 };
    },
    useAddProvider: () => () => {},
    clsx: require('clsx'),
    newDayjs,
    fromUtc,
    dayjs,
    Button: 'button',
    SafeImage: 'img',
  }
);
for (const state of ['ERROR', 'PUBLISHED']) {
  const item = CalendarItem({
    display: 'month',
    date: now(),
    state,
    integrations,
    post: {
      ...post('tick', '2026-11-04T06:00:00Z'),
      state,
      error: 'Provider rejected the post',
    },
  });
  check(
    item.props['data-state'] === state &&
      item.props['aria-label'].includes(state),
    `${state}: tick carries accessible state and visible mark selector`
  );
  if (state === 'ERROR') {
    check(
      item.props['data-tooltip-id'] === 'tooltip' &&
        item.props['data-tooltip-content'] === 'Provider rejected the post',
      'Error tooltip preserves actual publishing error'
    );
    check(
      item.props['aria-label'].includes('Provider rejected the post'),
      'Error is available to screen readers without hovering'
    );
  }
  for (const key of [null, 'Enter', ' ']) {
    let stopped = false;
    let prevented = false;
    const before = detailOpens;
    const event = {
      key,
      stopPropagation: () => {
        stopped = true;
      },
      preventDefault: () => {
        prevented = true;
      },
    };
    key ? item.props.onKeyDown(event) : item.props.onClick(event);
    check(
      stopped && detailOpens === before + 1 && (!key || prevented),
      `${state}: ${key || 'tap'} opens details without bubbling to create slot`
    );
  }
}
for (const mode of ['', 'https://example.test']) {
  linkselfUrl = mode;
  for (const display of ['day', 'week', 'month']) {
    calendar = {
      ...calendar,
      display,
      posts: [],
      postDates: new Map(),
      currentHour: now().startOf('hour'),
    };
    const column = CalendarColumn({ getDate: now().add(1, 'day') });
    const slot = nodes(column).find((n) =>
      n.props.className?.includes('glass-slot-label')
    );
    check(
      slot &&
        slot.props.role === undefined &&
        slot.props.tabIndex === undefined &&
        slot.props.onKeyDown === undefined &&
        typeof slot.props.onClick === 'function',
      `${
        mode ? 'LinkSelf' : 'upstream'
      } ${display}: slot preserves original pointer route and tab order`
    );
  }
}
linkselfUrl = 'https://example.test';

// Render the real rail for paid, free and upstream modes.
let menuUser = { orgId: 'org', role: 'ADMIN', tier: { current: 'PRO' } };
const { TopMenu } = component(
  'apps/frontend/src/components/layout/top.menu.tsx',
  ['TopMenu'],
  {
    useUser: () => menuUser,
    useVariables: () => ({
      linkselfUrl,
      isGeneral: true,
      billingEnabled: true,
    }),
    useMenuItem: () => ({
      firstMenu: [
        { path: '/launches', name: 'Calendar' },
        { path: '/analytics', name: 'Analytics' },
        { path: '/media', name: 'Media' },
        { path: '/agents', name: 'Agent', hide: true },
      ],
      secondMenu: [{ path: '/settings', name: 'Settings', role: ['ADMIN'] }],
    }),
    MenuItem: 'menu-item',
    LogoutComponent: 'logout',
  }
);
let menu = TopMenu();
const destinations = nodes(menu)
  .filter((n) => n.type === 'menu-item')
  .map((n) => n.props.path);
check(
  JSON.stringify(destinations) ===
    JSON.stringify([
      'https://example.test/dashboard',
      'https://example.test/dashboard/links',
      '/launches',
      'https://example.test/dashboard/products',
      'https://example.test/dashboard/analytics',
      'https://example.test/dashboard/settings',
    ]),
  'Shared rail exposes exactly the category destinations in the requested order'
);
check(
  !nodes(menu).some((n) => n.type === 'details' || n.type === 'summary') &&
    !text(menu).includes('All tools'),
  'LinkSelf has no All tools menu'
);
check(
  nodes(menu).filter((n) => n.type === 'logout').length === 1,
  'Rail has a single logout'
);
menuUser = { ...menuUser, tier: { current: 'FREE' } };
menu = TopMenu();
check(
  JSON.stringify(nodes(menu).filter((n) => n.type === 'menu-item').map((n) => n.props.path)) === JSON.stringify(destinations),
  'Shared category rail remains identical across plans; Settings retains feature permissions'
);
check(
  JSON.stringify(nodes(menu).filter((n) => n.type === 'menu-item').map((n) => n.props.label)) ===
    JSON.stringify(['Home', 'My page', 'Studio', 'Sell', 'Audience', 'Settings']),
  'Shared rail has exactly the approved labels and order'
);
const bottomRail = nodes(menu).find((n) => n.props.className === 'glass-rail-bottom');
check(
  React.Children.toArray(bottomRail.props.children).map((n) => n.type).join(',') === 'menu-item,logout,span',
  'Bottom rail contains Settings, Logout and avatar in order'
);
const lucide = require('lucide-react');
const { renderToStaticMarkup } = require('react-dom/server');
const iconShapes = (element) => renderToStaticMarkup(element).match(/<(path|rect|circle|line)\b[^>]*>/g);
for (const [index, name] of ['LayoutDashboard', 'Link', 'Send', 'ShoppingBag', 'BarChart3', 'Settings'].entries()) {
  const item = nodes(menu).filter((n) => n.type === 'menu-item')[index];
  check(
    JSON.stringify(iconShapes(item.props.icon)) === JSON.stringify(iconShapes(React.createElement(lucide[name]))),
    `${item.props.label} uses the requested lucide ${name} inline SVG geometry`
  );
  check(item.props.icon.props.strokeWidth === '2', `${item.props.label} uses lucide's default stroke`);
}
const { LogoutComponent: LabelledLogout } = component(
  'apps/frontend/src/components/layout/logout.component.tsx', ['LogoutComponent'],
  { useVariables: () => ({ linkselfUrl }), useFetch: () => () => {},
    useCallback: (f) => f, useT: () => (_, fallback) => fallback, APP_NAME: 'LinkSelf Social' }
);
const logoutButton = nodes(LabelledLogout({ isIcon: true })).find((n) => n.props.role === 'button');
check(text(logoutButton).trim() === 'Logout' && logoutButton.props['aria-label'] === 'Logout', 'Logout has the shared visible and accessible label');
check(JSON.stringify(iconShapes(nodes(logoutButton).find((n) => n.type === 'svg'))) === JSON.stringify(iconShapes(React.createElement(lucide.LogOut))), 'Logout matches the shared lucide LogOut icon');
linkselfUrl = '';
menu = TopMenu();
check(
  !nodes(menu).some(
    (n) => n.props.path === '/plugs' || n.props.label === 'My page'
  ),
  'Upstream menu receives no LinkSelf destinations'
);
linkselfUrl = 'https://example.test';

let switchValue;
const { Slider } = component(
  'libraries/react-shared-libraries/src/form/slider.tsx',
  ['Slider'],
  {
    useVariables: () => ({ linkselfUrl }),
    useCallback: (f) => f,
  }
);
for (const value of ['on', 'off']) {
  const toggle = Slider({
    value,
    onChange: (next) => {
      switchValue = next;
    },
  });
  check(
    toggle.type === 'button' &&
      toggle.props.role === 'switch' &&
      toggle.props['aria-checked'] === (value === 'on'),
    `Switch ${value} has native keyboard behavior and state`
  );
  check(
    nodes(toggle).some((node) => node.props.className === 'glass-switch-thumb'),
    `Switch ${value} has a visible thumb`
  );
  toggle.props.onClick();
  check(
    switchValue === (value === 'on' ? 'off' : 'on'),
    `Switch ${value} toggles state`
  );
}

// The merged editor row retains both selection and per-channel editing.
const editorChannels = [
  { id: 'a', name: 'Channel A', identifier: 'network' },
  { id: 'b', name: 'Channel B', identifier: 'network' },
  { id: 'disabled', name: 'Disabled', disabled: true },
];
let editorExisting = {};
const editorStore = {
  integrations: editorChannels,
  selectedIntegrations: [{ integration: editorChannels[0] }],
  current: 'global',
  locked: false,
  setHide() {},
  setCurrent(id) {
    editorStore.current = id;
  },
  addOrRemoveSelectedIntegration(integration) {
    editorStore.selectedIntegrations = editorStore.selectedIntegrations.some(
      (p) => p.integration.id === integration.id
    )
      ? editorStore.selectedIntegrations.filter(
          (p) => p.integration.id !== integration.id
        )
      : [...editorStore.selectedIntegrations, { integration }];
  },
};
const clsx = (...args) => args.filter(Boolean).join(' ');
const { SelectCurrent } = component(
  'apps/frontend/src/components/new-launch/select.current.tsx',
  ['SelectCurrent'],
  {
    useVariables: () => ({ linkselfUrl }),
    useExistingData: () => editorExisting,
    useDecisionModal: () => ({ open: async () => true }),
    useLaunchStore: (selector) => selector(editorStore),
    useShallow: (selector) => selector,
    useRef: () => ({ current: null }),
    useHasScroll: () => false,
    useCallback: (f) => f,
    GlobalIcon: 'svg',
    clsx,
  }
);
let channelPicker = SelectCurrent();
check(
  nodes(channelPicker).filter((n) => n.type === 'input').length === 2,
  'Merged row lists available channels only'
);
nodes(channelPicker)
  .find((n) => n.props['aria-label'] === 'Post to Channel B')
  .props.onChange();
check(
  editorStore.selectedIntegrations.length === 2,
  'Channel checkbox adds a publishing destination'
);
channelPicker = SelectCurrent();
nodes(channelPicker)
  .find((n) => n.props['aria-label'] === 'Channel B: edit channel post')
  .props.onClick();
check(
  editorStore.current === 'b' && editorStore.selectedIntegrations.length === 2,
  'Editing a selected channel does not deselect it'
);
nodes(channelPicker)
  .find((n) => n.props['aria-label'] === 'Edit shared post')
  .props.onClick();
check(
  editorStore.current === 'global',
  'Merged row retains shared content editing'
);
nodes(channelPicker)
  .find((n) => n.props['aria-label'] === 'Post to Channel B')
  .props.onChange();
check(
  editorStore.selectedIntegrations.length === 1,
  'Checkbox removes a publishing destination'
);
editorExisting = { integration: 'a', siblings: [{ integration: 'b' }] };
channelPicker = SelectCurrent();
check(
  !nodes(channelPicker).some(
    (n) => n.type === 'input' || n.props['aria-label'] === 'Edit shared post'
  ),
  'Existing posts retain fixed channels without a shared editor'
);
const { PostTargets } = component(
  'apps/frontend/src/components/new-launch/manage.modal.tsx',
  ['PostTargets'],
  { clsx }
);
for (const [count, expected] of [
  [0, ''], // the post button itself says Pick a channel
  [1, 'Posts to 1 channel'],
  [5, 'Posts to 5 channels'],
]) {
  const status = PostTargets({ count });
  check(
    text(status) === expected && status.props['aria-live'] === 'polite',
    `Destination count updates for ${count} selected channels`
  );
}
let activeQuery = 'tab=plugs';
const { MenuItem } = component(
  'apps/frontend/src/components/new-layout/menu-item.tsx',
  ['MenuItem'],
  {
    usePathname: () => '/settings',
    useSearchParams: () => new URLSearchParams(activeQuery),
    useVariables: () => ({ linkselfUrl }),
    URLSearchParams,
    clsx,
    Link: 'a',
  }
);
for (const tab of ['sets', 'signatures', 'plugs', 'global_settings']) {
  activeQuery = `tab=${tab}`;
  const paths = [
    '/settings?tab=sets',
    '/settings?tab=signatures',
    '/plugs',
    '/settings',
  ];
  const selected = paths.filter(
    (path) => MenuItem({ path, label: path }).props['aria-current'] === 'page'
  );
  check(
    selected.length === 1 &&
      selected[0] ===
        (tab === 'plugs'
          ? '/plugs'
          : tab === 'global_settings'
          ? '/settings'
          : `/settings?tab=${tab}`),
    `Rail tracks ${tab} including redirect routes`
  );
}

// The category stays selected across Studio routes; the page tab carries route state.
let studioPath = '/launches';
const { MenuItem: CategoryItem } = component(
  'apps/frontend/src/components/new-layout/menu-item.tsx', ['MenuItem'],
  { usePathname: () => studioPath, useSearchParams: () => new URLSearchParams(),
    useVariables: () => ({ linkselfUrl }), URLSearchParams, clsx, Link: 'a' }
);
const { StudioTabs } = component(
  'apps/frontend/src/components/layout/studio.tabs.tsx', ['StudioTabs'],
  { usePathname: () => studioPath, useVariables: () => ({ linkselfUrl }), Link: 'a' }
);
for (const base of ['https://example.test', 'https://example.test/']) {
  linkselfUrl = base;
  for (const [route, selected] of [
    ['/launches', 'Calendar'], ['/analytics', 'Analytics'], ['/media', 'Media'],
    ['/settings', 'Settings'], ['/plugs', 'Settings'], ['/launches/detail', 'Calendar'],
    ['/agents', undefined],
  ]) {
    studioPath = route;
    const links = nodes(StudioTabs()).filter((n) => n.type === 'a');
    check(JSON.stringify(links.map(text)) === JSON.stringify(['Calendar', 'Analytics', 'Media', 'Settings', 'Channels setup', 'Campaigns']), `${route}: category tabs have the exact labels and order`);
    check(JSON.stringify(links.map((n) => n.props.href)) === JSON.stringify(['/launches', '/analytics', '/media', '/settings', 'https://example.test/dashboard/social', 'https://example.test/dashboard/campaigns']), `${route}: category tabs resolve to exact destinations`);
    check(links.every((n) => n.props.target === undefined), `${route}: every tab uses the same tab`);
    check(JSON.stringify(links.filter((n) => n.props['aria-current'] === 'page').map(text)) === JSON.stringify(selected ? [selected] : []), `${route}: only the current Studio tab is selected`);
    const rail = nodes(TopMenu()).filter((n) => n.type === 'menu-item').map((n) => CategoryItem(n.props));
    check(rail.filter((n) => n.props['aria-current'] === 'page').map((n) => n.props['aria-label']).join() === 'Studio', `${route}: Studio is the only active rail category`);
    check(rail.every((n) => n.props.target === undefined), `${route}: all LinkSelf rail links stay in the same tab`);
  }
}
linkselfUrl = '';
check(StudioTabs() === null, 'Upstream never renders Studio category tabs');
check(CategoryItem({ path: 'https://external.test', label: 'External' }).props.target === '_blank', 'Upstream external menu links retain their target');
linkselfUrl = 'https://example.test';
check(CategoryItem({ path: 'https://external.test', label: 'External' }).props.target === '_blank', 'Unrelated external destinations retain their target');

// Settings keeps its existing feature gates and its independent second tab row.
let settingsTab = 'global_settings';
const { SettingsPopup } = component(
  'apps/frontend/src/components/layout/settings.component.tsx', ['SettingsPopup'],
  {
    useVariables: () => ({ linkselfUrl, isGeneral: true }),
    useOrganizationLimits: () => ({ data: { mcp: false } }),
    useFetch: () => () => {}, useToaster: () => ({}), useSWRConfig: () => ({}),
    useUser: () => menuUser, useMemo: (f) => f(), classValidatorResolver: () => ({}), UserDetailDto: {},
    useForm: () => ({ watch: () => '', handleSubmit: () => () => {} }),
    useModals: () => ({}), useCallback: (f) => f, useEffect: () => {},
    useSearchParams: () => new URLSearchParams(`tab=${settingsTab}`), useRouter: () => ({}),
    useState: (init) => [init(), () => {}], useT: () => (_, fallback) => fallback,
    clsx, FormProvider: 'form-provider', SVGLine: 'svg-line',
    GlobalSettings: 'global-settings', Sets: 'sets', SignaturesComponent: 'signatures',
    Plugs: 'plugs', ThirdPartyComponent: 'integrations', AppsComponent: 'apps',
  }
);
for (const plan of ['FREE', 'PRO']) {
  menuUser = { ...menuUser, tier: { current: plan } };
  for (settingsTab of ['global_settings', 'plugs', 'sets', 'signatures']) {
    const settings = SettingsPopup({});
    const buttons = nodes(settings).filter((n) => n.type === 'button');
    const allowed = plan === 'PRO' || !['sets', 'signatures'].includes(settingsTab);
    check(buttons.some((n) => text(n).trim() === 'Plugs'), `${plan}: Plugs remains in Settings' second row`);
    check(['Sets', 'Signatures'].every((label) => buttons.some((n) => text(n).trim() === label) === (plan === 'PRO')), `${plan}: Settings preserves Sets and Signatures feature permissions`);
    check(buttons.filter((n) => n.props['aria-current'] === 'page').map(text).join().trim() === ({ global_settings: 'Global Settings', plugs: 'Plugs', sets: 'Sets', signatures: 'Signatures' })[allowed ? settingsTab : 'global_settings'], `${plan}: second row tracks ${settingsTab} independently`);
  }
}
check(fs.readFileSync('apps/frontend/src/app/(app)/(site)/plugs/page.tsx', 'utf8').includes("redirect('/settings?tab=plugs')"), '/plugs still redirects to the Settings Plugs tab');

const { AddProviderComponent } = component(
  'apps/frontend/src/components/launches/add.provider.component.tsx',
  ['AddProviderComponent'],
  {
    useVariables: () => ({ linkselfUrl }),
    useOrganizationLimits: () => ({ data: { channels: 25, channelsUsed: 5 } }),
    useToaster: () => ({}),
    useRouter: () => ({}),
    useFetch: () => () => {},
    useModals: () => ({}),
    useCallback: (f) => f,
    useT: () => (_, fallback) => fallback,
    clsx,
  }
);
const providerChoices = Array.from({ length: 28 }, (_, i) => ({
  identifier: `network-${i}`,
  name: `Network ${i}`,
}));
providerChoices[0] = {
  identifier: 'instagram',
  name: 'Instagram (Facebook Business)',
  toolTip: 'Connect your business account',
};
let providerPicker = AddProviderComponent({
  social: providerChoices,
  article: [],
  invite: false,
});
check(
  nodes(providerPicker).filter((n) => n.props.role === 'button').length === 28,
  'Compact picker retains every supplied network'
);
check(
  text(providerPicker).includes('Instagram') &&
    !text(providerPicker).includes('Facebook Business'),
  'Long channel label is compact'
);
check(
  nodes(providerPicker).some(
    (n) =>
      n.props['data-tooltip-content'] ===
      'Instagram (Facebook Business): Connect your business account'
  ),
  'Connection hint remains in the tooltip'
);
linkselfUrl = '';
providerPicker = AddProviderComponent({
  social: providerChoices,
  article: [],
  invite: false,
});
check(
  text(providerPicker).includes('Instagram (Facebook Business)'),
  'Upstream keeps its original channel label'
);
linkselfUrl = 'https://example.test';

let requests = 0;
let opened;
const { NewPost } = component(
  'apps/frontend/src/components/launches/new.post.tsx',
  ['NewPost'],
  {
    useFetch: () => async () => {
      requests++;
      return { json: async () => ({ date: '2026-11-10T12:00:00Z' }) };
    },
    useModals: () => ({
      openModal: (value) => {
        opened = value;
      },
    }),
    useCalendar: () => ({
      integrations,
      sets: [],
      reloadCalendarView: () => {},
    }),
    useT: () => (_, fallback) => fallback,
    useCallback: (f) => f,
    fromUtc,
    AddEditModal: () => null,
  }
);
const actions = [];
const action = (name) => () => () => actions.push(name);
const { useLoadedPostDetails } = component(
  'apps/frontend/src/components/launches/calendar.tsx',
  ['useLoadedPostDetails'],
  {
    useModals: () => ({
      openModal: (value) => {
        opened = value;
      },
    }),
    usePostActions: () => ({
      editPost: action('edit'),
      deletePost: action('delete'),
      openStatistics: action('statistics'),
      openMissingRelease: action('connect'),
      openPost: action('open'),
      copyDebugJson: action('debug'),
    }),
    useCalendar: () => ({
      integrations: [{ id: 'a', hasPostAnalytics: true }],
    }),
    useUser: () => ({}),
    useT: () => (_, fallback) => fallback,
    fromUtc,
    stripHtmlValidation: (_, value) => value,
    Button: 'button',
  }
);
const detail = {
  ...post('detail', '2026-11-04T06:00:00Z'),
  state: 'PUBLISHED',
  releaseId: 'missing',
};
useLoadedPostDetails()(detail)();
nodes(opened.children)
  .find((n) => n.type === 'button' && text(n) === 'Statistics')
  .props.onClick();
check(
  actions.pop() === 'connect',
  'Missing release IDs route through existing Connect Post action'
);
useLoadedPostDetails()({ ...detail, releaseId: 'published-id' })();
nodes(opened.children)
  .find((n) => n.type === 'button' && text(n) === 'Statistics')
  .props.onClick();
check(actions.pop() === 'statistics', 'Published release IDs open statistics');
useLoadedPostDetails()({ ...detail, releaseId: null })();
check(
  !text(opened.children).includes('Statistics'),
  'Posts without a release ID do not expose statistics'
);
useLoadedPostDetails()({
  ...detail,
  state: 'ERROR',
  releaseURL: 'https://example.test/post',
})();
nodes(opened.children)
  .find((n) => n.type === 'button' && text(n) === 'Open post')
  .props.onClick();
check(
  actions.pop() === 'open',
  'ERROR posts with release URLs retain Open post'
);
useLoadedPostDetails()({ ...detail, state: 'ERROR', releaseURL: null })();
check(
  !text(opened.children).includes('Open post'),
  'ERROR posts without release URLs do not offer Open post'
);
for (const label of ['Edit post', 'Duplicate', 'Preview', 'Delete'])
  check(
    text(opened.children).includes(label),
    `Month details preserve ${label}`
  );

// Channels use the same data, action menu and drag payload as the upstream sidebar.
const launchesFile = 'apps/frontend/src/components/launches/launches.component.tsx';
const noop = () => {};
let channelData = Array.from({ length: 7 }, (_, index) => ({
  id: `channel-${index}`, name: `Account ${index}`, identifier: 'network',
  picture: '/account.jpg', type: 'social', disabled: false,
  customer: index > 3 ? { id: 'customer', name: 'Customer' } : undefined,
}));
let channelModal;
let addCalls = 0;
let reconnectCalls = 0;
let continueCalls = 0;
let channelDrop;
let channelDrag;
let channelRequest;
let channelReloads = 0;
let channelUpdate;
const dragManager = {};
const channelProps = {
  refreshChannel: () => () => reconnectCalls++,
  continueIntegration: () => () => continueCalls++,
  update: (reload) => { channelUpdate = reload; },
};
const channelComponents = component(launchesFile,
  ['useChannelGroups', 'MenuGroupComponent', 'MenuComponent', 'ChannelsPopup', 'ChannelsButton', 'LaunchesComponent'], {
    ...require('lodash'), clsx: require('clsx'),
    useState: (value) => [value, noop], useMemo: (f) => f(),
    useCallback: (f) => f, useEffect: noop,
    useFetch: () => async (url, options) => { channelRequest = { url, ...options }; },
    useUser: () => ({ totalChannels: 25 }),
    useVariables: () => ({ linkselfUrl }),
    useRouter: () => ({}), useSearchParams: () => new URLSearchParams(),
    useToaster: () => ({}), useFireEvents: () => noop,
    useT: () => (key, fallback) => fallback || key,
    useModals: () => ({ openModal: (value) => { channelModal = value; } }),
    useCookie: (_, fallback) => [fallback, noop],
    useIntegrationList: () => ({ data: channelData, mutate: noop }),
    useCalendar: () => ({ integrations: channelData, reloadCalendarView: () => channelReloads++ }),
    useDragDropManager: () => dragManager,
    useAddProvider: () => () => addCalls++,
    useDrag: (f) => { channelDrag = f(); return [{}, noop, noop]; },
    useDrop: (f) => { channelDrop = f(); return [{}, noop]; },
    localStorage: { getItem: () => '0' },
    process: { env: {} },
    ImageWithFallback: 'channel-image', SafeImage: 'network-image', Menu: 'channel-menu',
    CalendarContext: { Provider: 'calendar-context' }, DndProvider: 'dnd-context',
    DNDProvider: 'dnd', Onboarding: 'onboarding', ChannelsAfterPayment: 'after-payment',
    HubspotInstalled: 'hubspot', CalendarWeekProvider: 'calendar-provider',
    AddProviderButton: 'add-provider', NewPost: 'new-post', GeneratorComponent: 'generator',
    Filters: 'filters', Calendar: 'calendar', ScheduledPosts: 'schedule', EditPencil: 'pencil',
  });
linkselfUrl = 'https://example.test';
let channelTree = channelComponents.LaunchesComponent();
check(!nodes(channelTree).some((n) => n.props.className?.includes('glass-channels ')), 'LinkSelf removes the entire channel rows section');
check(nodes(channelTree).filter((n) => n.type === channelComponents.ChannelsButton).length === 1, 'LinkSelf has one Channels control for every viewport');
check(nodes(channelTree).some((n) => n.type === 'new-post'), 'Desktop creation action survives sidebar removal');
linkselfUrl = '';
channelTree = channelComponents.LaunchesComponent();
check(nodes(channelTree).some((n) => n.props.id === 'calendar-channels' && n.type === 'div'), 'Upstream keeps its sidebar and original anchor');
check(!nodes(channelTree).some((n) => n.type === channelComponents.ChannelsButton), 'Upstream does not acquire the popup toolbar');
linkselfUrl = 'https://example.test';
channelTree = channelComponents.ChannelsButton(channelProps);
check(channelTree.type === 'button' && channelTree.props.id === 'calendar-channels', 'Tour anchor is the keyboard-accessible Channels button');
check(nodes(channelTree).filter((n) => n.type === 'channel-image').length === 5 && text(channelTree).includes('+ 2'), 'Stack shows five account icons and remaining count');
check(text(channelTree).includes('Channels') && text(channelTree).includes('7'), 'Button labels the real channel count');
channelTree.props.onClick();
check(channelModal.title === 'Channels' && channelModal.closeOnEscape && channelModal.closeOnClickOutside, 'Channels opens the existing dismissible modal');
check(channelModal.children.props.manager === dragManager, 'Popup reuses the calendar drag manager');
const popupProps = channelModal.children.props.children.props;
channelTree = channelComponents.ChannelsPopup(popupProps);
const groups = nodes(channelTree).filter((n) => n.type === channelComponents.MenuGroupComponent);
check(groups.length === 2 && groups.some((n) => n.props.group.name === 'Customer'), 'Popup retains customer groups');
check(groups.every((n) => n.props.compact), 'Popup requests tiles instead of rows');
nodes(channelTree).find((n) => n.type === 'button').props.onClick();
check(addCalls === 1, 'Last Add tile invokes the existing Add Channel flow directly');
let tile = channelComponents.MenuComponent({ ...channelProps, compact: true, integration: { ...channelData[0], disabled: true, refreshNeeded: true }, totalNonDisabledChannels: 6 });
check(text(tile).includes('Disabled') && text(tile).includes('Needs reconnect'), 'Disabled and disconnected states have visible text');
check(channelDrag.type === 'menu' && channelDrag.item.id === channelData[0].id, 'Tile retains the channel drag payload');
check(nodes(tile).some((n) => n.type === 'network-image' && n.props.alt === 'network'), 'Tile includes a named network badge');
let tileMenu = nodes(tile).find((n) => n.type === 'channel-menu');
check(tileMenu.props.inChannelsPopup && tileMenu.props.canEnable && !tileMenu.props.canDisable && tileMenu.props.refreshChannel === channelProps.refreshChannel, 'Tile reuses the full menu with enable and refresh capabilities');
nodes(tile).find((n) => n.type === 'button').props.onClick();
check(reconnectCalls === 1, 'Reconnect tile action uses the existing handler');
tile = channelComponents.MenuComponent({ ...channelProps, compact: true, integration: { ...channelData[0], inBetweenSteps: true }, totalNonDisabledChannels: 7 });
nodes(tile).find((n) => n.type === 'button').props.onClick();
check(continueCalls === 1, 'Incomplete channel keeps its continuation action');
const customerGroup = groups.find((n) => n.props.group.id === 'customer');
channelTree = channelComponents.MenuGroupComponent(customerGroup.props);
check(nodes(channelTree).some((n) => n.props.className === 'glass-channel-grid'), 'Groups render grids even when their old sidebar was collapsed');
check(nodes(channelTree).some((n) => n.type === 'button' && n.props['aria-label'].includes('Edit group name')), 'Customer group rename remains keyboard-accessible');
channelDrop.drop({ id: channelData[0].id });
check(channelRequest.url === `/integrations/${channelData[0].id}/group` && channelRequest.method === 'PUT' && JSON.parse(channelRequest.body).group === 'customer', 'Dropping a tile uses the existing group endpoint');
channelData = [{ ...channelData[0], name: 'Renamed', disabled: true }];
channelTree = channelComponents.ChannelsPopup(popupProps);
check(channelTree.props.value.integrations[0].name === 'Renamed' && channelTree.props.value.integrations[0].disabled, 'Open popup subscribes to updated integration data');
channelData = [];
channelTree = channelComponents.ChannelsButton(channelProps);
check(text(channelTree) === 'Connect a channel' && channelTree.props.className.includes('glass-action'), 'Empty button is the primary Connect a channel action');
channelTree = channelComponents.ChannelsPopup(popupProps);
check(text(channelTree).includes('No channels yet') && nodes(channelTree).some((n) => n.type === 'button'), 'Deleting the last channel leaves a usable Add tile');

// Mount the actual modal and Menu with real focus/click-outside hooks in an offline DOM.
async function checkChannelDialog() {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<!doctype html><button id="opener">Channels</button><div id="root"></div>');
  const savedGlobals = {};
  for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLAnchorElement', 'Document', 'ShadowRoot', 'Element', 'Node']) {
    savedGlobals[key] = Object.getOwnPropertyDescriptor(global, key);
    Object.defineProperty(global, key, { configurable: true, value: dom.window[key] });
  }
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { createRoot } = require('react-dom/client');
  const { createPortal } = require('react-dom');
  const { useFocusTrap, useClickOutside } = require('@mantine/hooks');
  const { useHotkeys } = require('react-hotkeys-hook');
  const { act } = React;
  const root = createRoot(document.getElementById('root'));
  const opener = document.getElementById('opener');
  opener.focus();
  let closes = 0;
  let nestedModal;
  const hooks = { ...React, document, window, clsx: require('clsx'), useT: () => (_, fallback) => fallback };
  const { Component: Dialog } = component('apps/frontend/src/components/layout/new-modal.tsx', ['Component'], {
    ...hooks, useFocusTrap, useHotkeys,
    useVariables: () => ({ linkselfUrl: 'https://example.test' }),
    useDecisionModal: () => ({ open: async () => true }),
    CurrentModalContext: React.createContext({ id: '' }),
  });
  const { Menu: RealMenu } = component('apps/frontend/src/components/launches/menu/menu.tsx', ['Menu'], {
    ...hooks, useClickOutside, createPortal,
    useFetch: () => async () => { throw new Error('Menu checks must not fetch'); },
    useRouter: () => ({}), useVariables: () => ({}), useToaster: () => ({}),
    useCalendar: () => ({ integrations: [{ id: 'one', name: 'Account', identifier: 'network', type: 'social', additionalSettings: true, originalName: 'Original', refreshNeeded: true }] }),
    useModals: () => ({ openModal: (value) => { nestedModal = value; } }),
    SettingsModal: () => React.createElement('button', null, 'Settings content'),
  });
  const menu = React.createElement(RealMenu, { inChannelsPopup: true, id: 'one', canEnable: false, canDisable: true, canChangeProfilePicture: true, canChangeNickName: true, refreshChannel: noop, onChange: noop, mutate: noop });
  const modal = { id: 'channels-test', title: 'Channels', children: menu, closeOnEscape: true, closeOnClickOutside: true };
  const render = async (extra = {}, nested) => {
    await act(async () => root.render(React.createElement(React.Fragment, null,
      React.createElement(Dialog, { key: 'channels', isLast: !nested, zIndex: 200, closeModal: () => closes++, modal: { ...modal, ...extra } }),
      nested && React.createElement(Dialog, { key: 'nested', isLast: true, zIndex: 201, closeModal: noop, modal: { ...nested, id: 'nested' } })
    )));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 5)));
  };
  const key = async (node, key, extra = {}) => {
    await act(async () => node.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, code: key, bubbles: true, cancelable: true, ...extra })));
    await act(async () => node.dispatchEvent(new dom.window.KeyboardEvent('keyup', { key, code: key, bubbles: true, ...extra })));
  };
  try {
    await render();
    const dialog = document.querySelector('[role="dialog"]');
    check(dialog && dialog.contains(document.activeElement), 'Modal initially focuses inside the dialog');
    const trigger = dialog.querySelector('[aria-haspopup="menu"]');
    trigger.focus();
    await key(trigger, 'Tab');
    check(document.activeElement === dialog.querySelector('button'), 'Tab from the last control wraps within the dialog');
    await key(document.activeElement, 'Tab', { shiftKey: true });
    check(document.activeElement === trigger, 'Shift Tab wraps to the last control');
    await key(trigger, 'Enter');
    const dropdown = dialog.querySelector('[role="menu"]');
    check(dropdown?.parentElement.hasAttribute('data-modal-overlays'), 'Menu is portalled to the modal overlay, outside the tile grid');
    check(dropdown.contains(document.activeElement), 'Keyboard opening focuses the first menu action');
    for (const label of ['Additional Settings', 'Reconnect channel', 'Disable Channel', 'Delete', 'Move / add to group', 'Rename channel', 'Edit Time Slots']) {
      check(dropdown.textContent.includes(label), `Popup menu preserves ${label}`);
    }
    await key(document.activeElement, 'ArrowDown');
    check(document.activeElement === dropdown.querySelectorAll('[role="menuitem"]')[1], 'Arrow keys navigate the existing action menu');
    await key(document.activeElement, 'Escape');
    check(!dialog.querySelector('[role="menu"]') && closes === 0 && document.activeElement === trigger, 'Escape closes the menu first and restores its trigger');
    await act(async () => trigger.click());
    const settings = Array.from(dialog.querySelectorAll('[role="menuitem"]')).find((n) => n.textContent.includes('Additional Settings'));
    await act(async () => settings.click());
    check(nestedModal?.title === 'Additional Settings' && !dialog.querySelector('[role="menu"]'), 'Existing settings action opens its existing modal');
    await render({}, nestedModal);
    const nestedDialog = document.querySelectorAll('[role="dialog"]')[1];
    check(nestedDialog.contains(document.activeElement), 'Nested channel settings owns focus above the Channels popup');
    const nestedButtons = nestedDialog.querySelectorAll('button');
    nestedButtons[nestedButtons.length - 1].focus();
    await key(document.activeElement, 'Tab');
    check(document.activeElement === nestedButtons[0], 'Only the top dialog traps Tab while channel settings is open');
    await render();
    check(document.activeElement === trigger, 'Closing nested settings restores focus to its channel menu trigger');
    await key(trigger, 'Escape');
    check(closes === 1, 'Escape closes the Channels dialog');
    await act(async () => document.querySelector('[aria-label="Close dialog"]').click());
    check(closes === 2, 'Backdrop closes the Channels dialog');
    await render({ closeOnEscape: false, closeOnClickOutside: false });
    await key(trigger, 'Escape');
    await act(async () => document.querySelector('[aria-label="Close dialog"]').click());
    check(closes === 2, 'Other LinkSelf dialogs retain explicit dismissal protections');
    await act(async () => root.unmount());
    check(document.activeElement === opener, 'Closing the dialog returns focus to the toolbar button');
  } finally {
    await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of Object.entries(savedGlobals)) {
      if (descriptor) Object.defineProperty(global, key, descriptor);
      else delete global[key];
    }
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
}

(async () => {
  // Invoke the actual drop callback, including its optimistic update and PUT.
  const runDrop = async ({
    display = 'month',
    source,
    target,
    state = 'DRAFT',
    interval = false,
  }) => {
    const dragged = { ...post('dragged', source), state };
    const changes = [];
    dropRequests.length = 0;
    dropDialog = undefined;
    calendar = {
      ...calendar,
      display,
      posts: [dragged],
      postDates: new Map([[dragged, fromUtc(source)]]),
      currentHour: now().startOf('hour'),
      changeDate: (id, date) => changes.push({ id, date }),
      reloadCalendarView: () => {},
    };
    CalendarColumn({ getDate: target });
    // The drag payload's date is the source cell, not the post's time.
    await dropSpec.drop({
      id: dragged.id,
      interval,
      date: fromUtc(source).endOf('day'),
    });
    return changes;
  };
  for (const mode of ['', 'https://example.test']) {
    linkselfUrl = mode;
    const label = mode ? 'LinkSelf' : 'upstream';
    for (const [source, target, local, utc] of [
      [
        '2026-11-20T15:00:00Z',
        '2026-11-21',
        '2026-11-21T10:00:00.000',
        '2026-11-21T15:00:00',
      ],
      [
        '2026-11-20T15:37:42.123Z',
        '2026-11-22',
        '2026-11-22T10:37:42.123',
        '2026-11-22T15:37:42',
      ],
      [
        '2026-11-20T02:15:00Z',
        '2026-11-22',
        '2026-11-22T21:15:00.000',
        '2026-11-23T02:15:00',
      ],
      [
        '2026-11-20T15:00:00Z',
        '2027-03-14',
        '2027-03-14T10:00:00.000',
        '2027-03-14T14:00:00',
      ],
    ]) {
      const changes = await runDrop({
        source,
        target: newDayjs(target).endOf('day'),
      });
      check(
        changes.length === 1 &&
          changes[0].id === 'dragged' &&
          changes[0].date.format('YYYY-MM-DDTHH:mm:ss.SSS') === local,
        `${label}: month optimistic date preserves local time on ${target}`
      );
      check(
        dropRequests.length === 1 &&
          dropRequests[0].url === '/posts/dragged/date' &&
          dropRequests[0].method === 'PUT' &&
          dropRequests[0].body.date === utc,
        `${label}: month PUT uses preserved time and target timezone offset on ${target}`
      );
    }
    for (const display of ['day', 'week']) {
      const target = newDayjs('2026-11-21T16:00:00');
      const changes = await runDrop({
        display,
        source: '2026-11-20T15:37:42Z',
        target,
      });
      check(
        changes[0].date.valueOf() === target.valueOf() &&
          dropRequests[0].body.date === '2026-11-21T21:00:00',
        `${label}: ${display} drop still uses its target slot time`
      );
    }
    for (const target of [
      newDayjs('2026-11-03').endOf('day'),
      now().endOf('day'),
    ]) {
      const changes = await runDrop({ source: '2026-11-20T15:00:00Z', target });
      check(
        changes.length === 0 && dropRequests.length === 0 && !dropDialog,
        `${label}: preserved time in a past hour is rejected before changes or requests`
      );
    }
    // Relative to the clock: a fixed hour turns into the past later in the day.
    const currentHour = now().hour();
    for (const hour of new Set([currentHour, Math.min(currentHour + 1, 23)])) {
      const source = newDayjs(
        `2026-11-20T${String(hour).padStart(2, '0')}:30:00`
      )
        .utc()
        .format();
      await runDrop({ source, target: now().endOf('day') });
      check(
        dropRequests.length === 1 &&
          fromUtc(dropRequests[0].body.date).hour() === hour,
        `${label}: today's current/future hour follows the existing allowed-slot rule`
      );
    }
    const changes = await runDrop({
      source: '2026-11-20T15:00:00Z',
      target: newDayjs('2026-11-21').endOf('day'),
      interval: true,
    });
    check(
      changes.length === 0 &&
        dropRequests[0].body.date === '2026-11-21T15:00:00',
      `${label}: recurring month drop preserves time without an optimistic single-post update`
    );
  }
  linkselfUrl = 'https://example.test';
  for (const choice of ['schedule', 'update', 'cancel']) {
    dropChoice = choice;
    const changes = await runDrop({
      source: '2026-11-20T15:00:00Z',
      target: newDayjs('2026-11-21').endOf('day'),
      state: 'PUBLISHED',
    });
    check(
      text(dropDialog.children).includes('21/11/2026 10:00'),
      `${choice}: republish confirmation shows the preserved time`
    );
    check(
      choice === 'cancel'
        ? changes.length === 0 && dropRequests.length === 0
        : changes.length === 1 &&
            dropRequests[0].body.action === choice &&
            dropRequests[0].body.date === '2026-11-21T15:00:00' &&
            dropRequests[0].body.republish ===
              (choice === 'schedule' ? true : undefined),
      `${choice}: existing republish choice and cancellation behavior is retained`
    );
  }

  const date = newDayjs('2026-11-07T12:00:00');
  await NewPost({ date }).props.onClick();
  check(requests === 0, 'Selected-day creation adds no request');
  check(
    opened.children.props.date.valueOf() === date.valueOf(),
    'Chosen date reaches the editor'
  );
  check(
    opened.children.props.allIntegrations.length === 2,
    'Editor receives complete integration store'
  );
  check(
    opened.id === 'add-edit-modal' &&
      opened.askClose &&
      !opened.closeOnClickOutside &&
      !opened.closeOnEscape,
    'Existing unsaved-edit protections preserved'
  );
  await NewPost({}).props.onClick();
  check(requests === 1, 'Existing NewPost action still finds a slot');
  let confirmed = true;
  let responseOk = true;
  let failRequest = false;
  let deleteRequests = 0;
  let reloads = 0;
  const closed = [];
  const modal = {
    openModal: (value) => {
      opened = value;
    },
    closeById: (id) => closed.push(id),
  };
  const { usePostActions: realPostActions } = component(
    'apps/frontend/src/components/launches/calendar.tsx',
    ['usePostActions'],
    {
      useT: () => (_, fallback) => fallback,
      useCallback: (f) => f,
      useModals: () => modal,
      useToaster: () => ({ show: () => {} }),
      useCalendar: () => ({
        integrations,
        reloadCalendarView: () => {
          reloads++;
        },
      }),
      useFetch: () => async () => {
        deleteRequests++;
        if (failRequest) throw new Error('offline');
        return { ok: responseOk };
      },
      deleteDialog: async () => confirmed,
    }
  );
  const { useLoadedPostDetails: realDetails } = component(
    'apps/frontend/src/components/launches/calendar.tsx',
    ['useLoadedPostDetails'],
    {
      useModals: () => modal,
      usePostActions: realPostActions,
      useCalendar: () => ({ integrations }),
      useUser: () => ({}),
      useT: () => (_, fallback) => fallback,
      fromUtc,
      stripHtmlValidation: (_, value) => value,
      Button: 'button',
    }
  );
  realDetails()(detail)();
  const remove = nodes(opened.children).find(
    (n) => n.type === 'button' && text(n) === 'Delete'
  ).props.onClick;
  confirmed = false;
  await remove();
  check(
    deleteRequests === 0 && closed.length === 0,
    'Cancelled delete keeps details open and sends no request'
  );
  confirmed = true;
  responseOk = false;
  await remove();
  check(
    closed.length === 0 && reloads === 0,
    'Unsuccessful DELETE keeps details open'
  );
  failRequest = true;
  await assert.rejects(remove, /offline/);
  check(
    closed.length === 0 && reloads === 0,
    'Thrown DELETE keeps details open'
  );
  failRequest = false;
  responseOk = true;
  await remove();
  check(
    closed.length === 1 && closed[0] === 'post-details-detail' && reloads === 1,
    'Successful DELETE refreshes calendar and closes only its details modal'
  );
  await customerGroup.props.update(true);
  check(channelUpdate === false && channelReloads === 1, 'Channel deletion reloads posts without unmounting the shared calendar drag manager');
  await checkChannelDialog();
  console.log(`Glass calendar behavior checks: ${count} passed, 0 failed.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
