// Exercise the actual calendar components without starting the app or a browser.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
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
  const sandbox = { exports: {}, React, ...bindings };
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
    useDrop: () => [{ canDrop: false }, () => {}],
    usePostActions: () => ({}),
    useModals: () => ({}),
    useFetch: () => () => {},
    useAddProvider: () => () => {},
    clsx: require('clsx'),
    newDayjs,
    fromUtc,
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

// The real All tools component closes on every supported dismissal route.
const listeners = new Map();
const cleanups = [];
let hasOpenModal = false;
let focused = false;
const toolsElement = {
  open: true,
  contains: (target) => target === 'inside',
  querySelector: () => ({
    focus: () => {
      focused = true;
    },
  }),
};
const { TopMenu } = component(
  'apps/frontend/src/components/layout/top.menu.tsx',
  ['TopMenu'],
  {
    useUser: () => ({ orgId: 'org', role: 'ADMIN', tier: 'PRO' }),
    useVariables: () => ({
      linkselfUrl,
      isGeneral: true,
      billingEnabled: true,
    }),
    useMenuItem: () => ({
      firstMenu: [{ path: '/launches', name: 'Calendar' }],
      secondMenu: [],
    }),
    useRef: () => ({ current: toolsElement }),
    useHasOpenModal: () => hasOpenModal,
    useEffect: (f) => {
      const cleanup = f();
      if (cleanup) cleanups.push(cleanup);
    },
    document: {
      addEventListener: (name, fn) => listeners.set(name, fn),
      removeEventListener: (name) => listeners.delete(name),
    },
    MenuItem: 'menu-item',
    Link: 'a',
    LogoutComponent: 'logout',
  }
);
let menu = TopMenu();
listeners.get('pointerdown')({ target: 'inside' });
check(toolsElement.open, 'All tools stays open on an internal pointer press');
listeners.get('pointerdown')({ target: 'outside' });
check(!toolsElement.open, 'All tools closes on outside pointer press');
toolsElement.open = true;
listeners.get('keydown')({ key: 'Escape' });
check(
  !toolsElement.open && focused,
  'All tools Escape closes and returns focus to summary'
);
toolsElement.open = true;
nodes(menu)
  .find((n) => n.type === 'nav')
  .props.onClick({ target: { closest: () => ({}) } });
check(!toolsElement.open, 'All tools closes on link activation');
toolsElement.open = true;
hasOpenModal = true;
menu = TopMenu();
check(!toolsElement.open, 'Opening a modal dismisses All tools');
let blocked = false;
nodes(menu)
  .find((n) => n.type === 'summary')
  .props.onClick({
    preventDefault: () => {
      blocked = true;
    },
  });
check(blocked, 'All tools cannot reopen through a modal');
cleanups.forEach((cleanup) => cleanup());
check(listeners.size === 0, 'All tools removes document listeners on unmount');

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

(async () => {
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
  console.log(`Glass calendar behavior checks: ${count} passed, 0 failed.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
