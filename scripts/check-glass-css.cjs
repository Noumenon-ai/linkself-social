// Compile styles locally and enforce the approved theme boundary and exact tokens.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sass = require('sass');
const postcss = require('postcss');
const tailwind = require('tailwindcss');

async function main() {
  const config = require('../apps/frontend/tailwind.config.cjs');
  const compiled = sass.compile('apps/frontend/src/app/global.scss', {
    loadPaths: ['node_modules'],
    logger: { warn() {} },
  });
  const css = (
    await postcss([
      tailwind({
        ...config,
        content: [
          {
            raw: 'text-red-500 text-white bg-white bg-forth text-customColor4 bg-customColor3 bg-[var(--studio-accent,#612BD3)] hover:bg-[var(--studio-hover,#5520CB)]',
            extension: 'html',
          },
        ],
      }),
    ]).process(compiled.css, { from: undefined })
  ).css;
  const root = postcss.parse(css);
  let checks = 0;
  const verify = (condition, message) => {
    assert(condition, message);
    checks++;
  };
  const check = (selector, property, value) => {
    const found = [];
    root.walkRules(selector, (rule) =>
      rule.walkDecls(property, (decl) => found.push(decl.value))
    );
    verify(
      found.includes(value),
      `${selector} ${property}: ${JSON.stringify(found)}`
    );
  };
  check(
    '.text-red-500',
    'color',
    'rgb(var(--studio-error-rgb, 239 68 68) / var(--tw-text-opacity, 1))'
  );
  check(
    '.text-white',
    'color',
    'rgb(var(--studio-text-rgb, 255 255 255) / var(--tw-text-opacity, 1))'
  );
  check(
    '.bg-white',
    'background-color',
    'rgb(var(--studio-panel-rgb, 255 255 255) / var(--tw-bg-opacity, 1))'
  );
  check(
    '.text-customColor4',
    'color',
    'var(--studio-text, var(--color-custom4))'
  );
  check(
    '.bg-customColor3',
    'background-color',
    'var(--studio-panel, var(--color-custom3))'
  );
  check(
    '.bg-\\[var\\(--studio-accent\\2c \\#612BD3\\)\\]',
    'background-color',
    'var(--studio-accent,#612BD3)'
  );
  const gate = 'html[data-linkself-theme=glass-frame]';
  root.walkDecls(/^--studio-/, (decl) => {
    verify(decl.parent.selector.includes(gate), 'Studio tokens must be gated');
  });
  const tokens = {
    page: '#10151F',
    'popup-color': 'rgba(16, 21, 31, 0.72)',
    frame: 'rgba(31, 40, 54, 0.92)',
    tile: 'rgba(52, 66, 84, 0.8)',
    'tile-hover': '#3B4B60',
    inset: '#222E40',
    popover: '#273449',
    text: '#F4F7FC',
    muted: '#BBC7D8',
    link: '#85C2FF',
    accent: '#2F95FF',
    button: '#2F95FF',
    'button-hover': '#65B1FF',
    'on-accent': '#07182B',
    coral: '#FF6347',
    lime: '#C9E650',
    focus: '#C9E650',
    'selected-top': '#1869B2',
    'selected-bottom': '#253B52',
    avatar: '#3D5573',
    'chart-bar': '#6087B1',
    line: 'rgba(200, 219, 244, 0.16)',
    'input-border': '#63758D',
    error: '#FF9B8F',
    success: '#8FE3B8',
    warning: '#FFD27A',
    shadow: '0 20px 70px rgba(4, 12, 25, 0.2)',
    'tile-highlight': 'inset 0 1px 0 rgba(255, 255, 255, 0.025)',
    'radius-frame': '40px',
    'radius-tile': '22px',
    'radius-small': '14px',
    'radius-pill': '999px',
  };
  const normalize = (value) =>
    value
      .replace(/\s+/g, '')
      .replace(/(?:0)?\.\d+/g, (number) => String(Number(number)));
  for (const [name, value] of Object.entries(tokens)) {
    let found = false;
    root.walkDecls(`--${name}`, (decl) => {
      if (!decl.parent.selector?.includes(gate)) return;
      verify(
        normalize(decl.value) === normalize(value),
        `Incorrect token --${name}: ${decl.value}`
      );
      found = true;
    });
    verify(found, `Missing token --${name}`);
  }
  const allowedColors = new Set(
    [
      ...Object.values(tokens).flatMap(
        (value) => value.match(/#[\da-f]{3,8}\b|rgba?\([^)]+\)/gi) || []
      ),
      'rgba(255, 255, 255, 0.1)',
      'rgba(133, 194, 255, 0.2)',
      'rgba(133, 194, 255, 0.14)',
      'rgba(30, 134, 220, 0.9)',
    ].map((value) => normalize(value).toLowerCase())
  );
  root.walkRules((rule) => {
    if (!rule.selector.includes(gate)) return;
    rule.walkDecls((decl) => {
      for (const color of decl.value.match(
        /#[\da-f]{3,8}\b|rgba?\([^)]+\)/gi
      ) || []) {
        verify(
          allowedColors.has(normalize(color).toLowerCase()),
          `Out-of-contract color: ${rule.selector} ${decl.prop}: ${color}`
        );
      }
    });
  });
  check(`${gate} body::before`, 'position', 'fixed');
  check(`${gate} body::before`, 'z-index', '-1');
  check(
    `${gate} .glass-launches`,
    'grid-template-columns',
    'minmax(0, 1fr) 260px'
  );
  check(
    `${gate} .glass-month-grid`,
    'grid-template-columns',
    'repeat(7, minmax(0, 1fr))'
  );
  check(`${gate} .glass-month-grid`, 'position', 'static');
  check(`${gate} .glass-rail`, 'width', '64px');
  verify(
    css.includes('@media (max-width: 999px)'),
    'Schedule must stack below 1000px'
  );
  verify(
    css.includes('@media (max-width: 760px)'),
    'Rail must become compact at 760px'
  );
  verify(
    css.includes('outline: 3px solid var(--focus) !important'),
    'Visible lime keyboard focus'
  );
  verify(
    css.includes('@media (prefers-reduced-motion: reduce)'),
    'Reduced motion support'
  );
  verify(
    !css.includes('--studio-grid'),
    'Retired drafting grid must be absent'
  );

  // Review regressions: inspect compiled declarations, including responsive rules.
  const ruleHas = (fragment, property, value, mobile = false) => {
    let found = false;
    root.walkRules((rule) => {
      if (!rule.selector.includes(gate) || !rule.selector.includes(fragment))
        return;
      if (mobile && !rule.parent.params?.includes('max-width: 760px')) return;
      rule.walkDecls(property, (decl) => {
        if (decl.value === value) found = true;
      });
    });
    verify(
      found,
      `${fragment}: ${property} must be ${value}${mobile ? ' on phones' : ''}`
    );
  };
  root.walkRules((rule) => {
    if (
      !rule.selector.includes(gate) ||
      !rule.selector.includes('.glass-event')
    )
      return;
    rule.walkDecls('width', (decl) => {
      if (decl.value === '3px')
        verify(
          !/\.glass-event p(?:,|$)/.test(rule.selector),
          'Event paragraphs must never be ticks'
        );
    });
  });
  check(`${gate} .glass-event footer::before`, 'width', '3px');
  check(`${gate} .glass-event footer::before`, 'height', '14px');
  check(`${gate} .glass-schedule input`, 'padding-inline', '16px');
  ruleHas('.animate-normalFadeDown', 'opacity', '1');
  for (const animation of ['normalFadeIn', 'fadeIn', 'fade', 'fadeDown']) {
    ruleHas(`.animate-${animation}`, 'opacity', '1');
  }
  ruleHas(
    '.glass-modal .glass-field-row[data-unlabelled] > div',
    'grid-column',
    '1/-1'
  );
  ruleHas('.glass-channel-grid', 'grid-template-columns', 'repeat(auto-fill, minmax(104px, 1fr))');
  ruleHas('.glass-channel-image', 'border-radius', 'var(--radius-pill)');
  ruleHas('.glass-channels-button', 'min-height', '44px');
  ruleHas('.glass-channels-button', 'border-radius', 'var(--radius-pill)');
  ruleHas('.glass-channel-name', 'text-overflow', 'ellipsis');
  ruleHas('.glass-channel-name', 'white-space', 'nowrap');
  ruleHas('.glass-modal-overlays', 'position', 'fixed');
  ruleHas('.glass-modal-overlays', 'z-index', '1');
  ruleHas('.glass-channel-menu-dropdown', 'max-height', 'calc(100dvh - 24px)');
  ruleHas('.glass-channel-menu-dropdown', 'max-width', 'calc(100vw - 24px)');
  ruleHas('.glass-channel-menu-dropdown', 'pointer-events', 'auto');
  ruleHas('.glass-channel-menu-dropdown', 'overflow-y', 'auto');
  const inputSource = fs.readFileSync(
    'libraries/react-shared-libraries/src/form/input.tsx',
    'utf8'
  );
  verify(
    inputSource.includes('data-unlabelled={!label || undefined}'),
    'Every empty-label Input opts into full width'
  );
  ruleHas('[role=button].glass-month-tick', 'min-height', '44px', true);
  ruleHas(
    '.glass-month-tick[data-state=ERROR]::after',
    'background',
    'var(--error)'
  );
  ruleHas(
    '.glass-month-tick[data-state=PUBLISHED]::after',
    'background',
    'var(--success)'
  );
  ruleHas('.glass-tools nav', 'inset-inline-start', '64px');
  ruleHas('.glass-rail-link::after', 'inset-inline-start', '56px');
  ruleHas('.glass-rail-link::after', 'inset-inline-end', '0', true);
  ruleHas('.glass-tools nav', 'z-index', '40');
  ruleHas('.glass-rail', 'z-index', '40');
  ruleHas(
    'body:has(.bg-popup, .mantine-Modal-root, .swal2-container) .glass-tools',
    'pointer-events',
    'none'
  );
  ruleHas('.mantine-Overlay-root', 'background', 'var(--popup-color)');
  const disabledDescendants =
    'body :is(button:disabled, [aria-disabled=true], [aria-busy=true]):not(.network-preview *) *';
  ruleHas(disabledDescendants, 'background', 'var(--inset)');
  ruleHas(disabledDescendants, 'color', 'var(--muted)');
  root.walkDecls('--new-bgColorInner', (decl) => {
    if (decl.parent.selector.includes(gate))
      verify(decl.value === 'var(--popover)', 'Inner popovers must be opaque');
  });
  root.walkRules((rule) => {
    if (!rule.selector.includes(gate)) return;
    if (rule.selector.includes('.glass-tools nav') || rule.selector.endsWith(' .glass-rail')) {
      rule.walkDecls('z-index', (decl) => verify(Number(decl.value) < 200, 'Rail and tools stay below the first modal'));
    }
    if (rule.selector.includes(':hover') &&
      (rule.selector.includes('[class*=\"hover:bg-\"]') || rule.selector.includes('.glass-action') || rule.selector.includes('.glass-secondary'))) {
      verify(rule.selector.includes(':is(button:disabled, [aria-disabled=true], [aria-busy=true]) *'), 'Hover rules exclude disabled/busy descendants');
    }
  });
  const layoutSource = fs.readFileSync(
    'apps/frontend/src/components/new-layout/layout.component.tsx',
    'utf8'
  );
  verify(
    !/linkselfUrl[^\n]*\/help/.test(layoutSource),
    'No nonexistent LinkSelf Help footer link'
  );

  const fontsDir = 'apps/frontend/src/fonts/figtree';
  const fonts = fs
    .readdirSync(fontsDir)
    .filter((name) => name.endsWith('.woff2'));
  verify(fonts.length === 2, 'Both variable Figtree subsets are required');
  for (const name of fonts) {
    verify(
      fs.readFileSync(`${fontsDir}/${name}`).subarray(0, 4).toString() ===
        'wOF2',
      `${name} is a WOFF2 font`
    );
  }
  verify(
    fs
      .readFileSync(`${fontsDir}/OFL.txt`, 'utf8')
      .includes('SIL OPEN FONT LICENSE'),
    'Font license retained'
  );
  const fontSource = fs.readFileSync(`${fontsDir}/figtree.font.ts`, 'utf8');
  verify(
    fontSource.includes("weight: '400 700'"),
    'Variable font supports approved weights'
  );
  for (const surface of ['(app)', '(provider)', '(extension)']) {
    const layout = fs.readFileSync(
      `apps/frontend/src/app/${surface}/layout.tsx`,
      'utf8'
    );
    verify(
      layout.includes(
        "data-linkself-theme={isLinkSelf ? 'glass-frame' : undefined}"
      ),
      `${surface}: theme must be gated`
    );
    verify(
      layout.includes('isLinkSelf && figtree.variable'),
      `${surface}: font must be gated`
    );
  }
  verify(
    fs
      .readFileSync(
        'apps/frontend/src/components/layout/mode.component.tsx',
        'utf8'
      )
      .includes('if (linkselfUrl) return null;'),
    'Mode toggle remains hidden only in LinkSelf'
  );
  // External BlueprintJS/Polotno dependency identifiers are not the retired theme.
  const scan = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        scan(file);
        continue;
      }
      if (!/\.(tsx?|scss|cjs|svg)$/.test(file)) continue;
      const source = fs
        .readFileSync(file, 'utf8')
        .replace(
          /@blueprintjs\/(core|icons)|polotno\.blueprint\.css/g,
          'external-library'
        );
      verify(
        !/blueprint|--font-(archivo|space-mono|architects)/i.test(source),
        `Retired theme in ${file}`
      );
      verify(
        !/#(?:1B3A5C|143049|EAF2FA|A9C1D9|2E5379|FF7A45|12161C)\b/i.test(
          source
        ),
        `Retired palette in ${file}`
      );
    }
  };
  scan('apps/frontend/src');
  scan('libraries/react-shared-libraries/src');
  verify(
    !fs.existsSync('apps/frontend/src/fonts/blueprint'),
    'Retired fonts removed'
  );
  verify(
    !fs.existsSync('apps/frontend/public/blueprint-icon.svg'),
    'Retired favicon removed'
  );

  // Composite against the strongest possible white band, then the translucent frame/tile.
  const mix = (a, b, alpha) => a.map((v, i) => v * alpha + b[i] * (1 - alpha));
  const rgb = (hex) => hex.match(/[\da-f]{2}/gi).map((v) => parseInt(v, 16));
  const luminance = (c) =>
    c
      .map((v) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      })
      .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const contrast = (a, b) => {
    const x = luminance(a);
    const y = luminance(b);
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };
  const frame = mix([31, 40, 54], [255, 255, 255], 0.92);
  const tile = mix([52, 66, 84], frame, 0.8);
  for (const foreground of ['text', 'muted', 'link']) {
    for (const background of [
      frame,
      tile,
      rgb(tokens.inset),
      rgb(tokens.popover),
      rgb(tokens['tile-hover']),
    ]) {
      verify(
        contrast(rgb(tokens[foreground]), background) >= 4.5,
        `Contrast failed: ${foreground}`
      );
    }
  }
  verify(
    contrast(rgb(tokens.text), rgb(tokens['selected-top'])) >= 4.5,
    'Selected date text contrast'
  );
  for (const button of ['button', 'button-hover'])
    verify(
      contrast(rgb(tokens['on-accent']), rgb(tokens[button])) >= 4.5,
      `Button contrast: ${button}`
    );
  console.log(
    `Glass CSS/font/contrast checks: ${checks} passed, 0 failed. Sass and Tailwind compilation passed.`
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
