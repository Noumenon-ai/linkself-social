// Offline geometry checks using the real rail/tabs and compiled styles. No app server.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { chromium } = require('playwright');
const sass = require('sass');
const postcss = require('postcss');
const tailwind = require('tailwindcss');

function component(file, name, bindings) {
  const source = ts.createSourceFile(
    file,
    fs.readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX
  );
  const declaration = source.statements.find(
    (statement) =>
      ts.isVariableStatement(statement) &&
      statement.declarationList.declarations.some(
        (d) => d.name.getText(source) === name
      )
  );
  const code = ts.transpileModule(
    declaration.getText(source).replace(/^export\s+/, ''),
    {
      compilerOptions: {
        jsx: ts.JsxEmit.React,
        target: ts.ScriptTarget.ES2020,
      },
    }
  ).outputText;
  const sandbox = { React, ...bindings };
  vm.runInNewContext(`${code}\nresult = ${name};`, sandbox, { filename: file });
  return sandbox.result;
}

async function main() {
  const shared = {
    useVariables: () => ({
      linkselfUrl: 'https://example.test',
      isGeneral: true,
      billingEnabled: true,
    }),
    usePathname: () => '/settings',
    useSearchParams: () => new URLSearchParams('tab=plugs'),
    URLSearchParams,
    clsx: require('clsx'),
    Link: ({ prefetch, ...props }) => React.createElement('a', props),
  };
  const MenuItem = component(
    'apps/frontend/src/components/new-layout/menu-item.tsx',
    'MenuItem',
    shared
  );
  const LogoutComponent = component(
    'apps/frontend/src/components/layout/logout.component.tsx',
    'LogoutComponent',
    {
      ...shared,
      useFetch: () => () => {},
      useCallback: (f) => f,
      useT: () => (_, fallback) => fallback,
      APP_NAME: 'LinkSelf Social',
    }
  );
  const TopMenu = component(
    'apps/frontend/src/components/layout/top.menu.tsx',
    'TopMenu',
    {
      ...shared,
      MenuItem,
      LogoutComponent,
      useUser: () => ({ email: 'creator@example.test' }),
      useMenuItem: () => ({ firstMenu: [], secondMenu: [] }),
    }
  );
  const StudioTabs = component(
    'apps/frontend/src/components/layout/studio.tabs.tsx',
    'StudioTabs',
    shared
  );
  const GlassBrand = component(
    'apps/frontend/src/components/ui/glass-brand.tsx',
    'GlassBrand',
    {}
  );
  // Mirror the shared shell wrappers; navigation children come from the actual components.
  const html = `<div class="glass-shell flex flex-col min-h-screen min-w-screen"><div class="glass-shell-layout flex-1 flex"><aside class="glass-rail glass-frame flex flex-col"><div id="left-menu" class="flex flex-1"><div class="flex flex-col h-full flex-1"><div class="flex justify-center">${renderToStaticMarkup(
    React.createElement(GlassBrand)
  )}</div>${renderToStaticMarkup(
    React.createElement(TopMenu)
  )}</div></div></aside><main class="glass-workspace glass-frame flex-1 min-w-0 flex flex-col"><div class="glass-topbar flex items-center"><div class="glass-heading"><h1 class="glass-title">Settings</h1></div></div>${renderToStaticMarkup(
    React.createElement(StudioTabs)
  )}<div class="glass-workspace-content flex flex-1 min-w-0"><div class="glass-settings"><div class="glass-settings-nav"><div class="glass-settings-tabs flex">${[
    'Global Settings',
    'Sets',
    'Signatures',
    'Integrations',
    'Plugs',
    'Apps',
  ]
    .map(
      (label) =>
        `<button${
          label === 'Plugs' ? ' aria-current="page"' : ''
        }>${label}</button>`
    )
    .join(
      ''
    )}</div></div><div class="glass-settings-content">Settings content</div></div></div></main></div></div>`;
  const compiled = sass.compile('apps/frontend/src/app/global.scss', {
    loadPaths: ['node_modules'],
    logger: { warn() {} },
  });
  const config = require('../apps/frontend/tailwind.config.cjs');
  const css = (
    await postcss([
      tailwind({ ...config, content: [{ raw: html, extension: 'html' }] }),
    ]).process(compiled.css, { from: undefined })
  ).css;
  const temp = fs.mkdtempSync(path.join(process.cwd(), '.glass-navigation-'));
  const originalTmp = process.env.TMPDIR;
  process.env.TMPDIR = temp;
  let browser;
  let checks = 0;
  const check = (value, message) => {
    assert(value, message);
    checks++;
  };
  try {
    browser = await chromium.launch({
      executablePath:
        process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
        chromium.executablePath(),
      headless: true,
      env: {
        ...process.env,
        XDG_CONFIG_HOME: path.join(temp, 'config'),
        XDG_CACHE_HOME: path.join(temp, 'cache'),
      },
    });
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.abort());
    await page.setContent(
      `<!doctype html><html data-linkself-theme="glass-frame"><head><style>${css}</style></head><body>${html}</body></html>`
    );
    for (const width of [320, 390, 760, 761, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const geometry = await page.evaluate(() => {
        const rail = document.querySelector('.glass-navigation');
        const rows = [
          rail,
          ...document.querySelectorAll('.glass-settings-tabs'),
        ];
        return {
          pageWidth: document.documentElement.scrollWidth,
          viewport: innerWidth,
          railWidth: document
            .querySelector('.glass-rail')
            .getBoundingClientRect().width,
          labels: [
            ...document.querySelectorAll(
              '.glass-rail-link > div:last-child, .glass-rail-label'
            ),
          ].map((node) => ({
            size: getComputedStyle(node).fontSize,
            visible: node.getBoundingClientRect().height > 0,
          })),
          rows: rows.map((node) => ({
            overflow: getComputedStyle(node).overflowX,
            tops: [
              ...node.querySelectorAll(
                node === rail ? '.glass-rail-link, .glass-avatar' : 'a, button'
              ),
            ].map((item) => Math.round(item.getBoundingClientRect().top)),
            centers: [
              ...node.querySelectorAll(
                node === rail ? '.glass-rail-link, .glass-avatar' : 'a, button'
              ),
            ].map((item) =>
              Math.round(
                item.getBoundingClientRect().top +
                  item.getBoundingClientRect().height / 2
              )
            ),
            width: node.clientWidth,
            scrollWidth: node.scrollWidth,
          })),
        };
      });
      check(
        geometry.pageWidth <= geometry.viewport,
        `${width}px: no sideways page scroll (${geometry.pageWidth})`
      );
      check(
        geometry.labels.length === 7 &&
          geometry.labels.every(
            (label) => label.size === '12px' && label.visible
          ),
        `${width}px: every rail destination has a visible 12px label`
      );
      for (const [index, row] of geometry.rows.entries()) {
        if (index === 0 && width > 760) continue;
        check(
          Math.max(...row.centers) - Math.min(...row.centers) <= 1,
          `${width}px: navigation row ${index} stays on one line`
        );
        check(
          row.overflow === 'auto',
          `${width}px: navigation row ${index} scrolls internally`
        );
      }
      if (width <= 390)
        check(
          geometry.rows.every((row) => row.scrollWidth > row.width),
          `${width}px: rail and both tab rows overflow internally`
        );
      if (width > 760)
        check(geometry.railWidth === 72, `${width}px: desktop rail is 72px`);
      for (const selector of ['.glass-navigation', '.glass-studio-tabs']) {
        const reachable = await page.locator(selector).evaluate((node) => {
          node.scrollLeft = node.scrollWidth;
          const last = node.lastElementChild.getBoundingClientRect();
          const bounds = node.getBoundingClientRect();
          node.scrollLeft = 0;
          return last.right <= bounds.right + 1;
        });
        check(
          reachable,
          `${width}px: final navigation item remains reachable in ${selector}`
        );
      }
    }
    console.log(
      `Glass navigation geometry checks: ${checks} passed, 0 failed.`
    );
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
