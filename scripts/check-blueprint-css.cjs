// Validate compiled styles without starting Next.js or making network requests.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const sass = require('sass');
const postcss = require('postcss');
const tailwind = require('tailwindcss');

async function main() {
  const config = require('../apps/frontend/tailwind.config.cjs');
  const compiled = sass.compile('apps/frontend/src/app/global.scss', {
    loadPaths: ['node_modules'], logger: { warn() {} },
  });
  const css = (await postcss([tailwind({
    ...config,
    content: [{ raw: 'text-red-500 text-white bg-white bg-forth text-customColor4 bg-customColor3 bg-[var(--studio-accent,#612BD3)] hover:bg-[var(--studio-hover,#5520CB)]', extension: 'html' }],
  })]).process(compiled.css, { from: undefined })).css;
  const root = postcss.parse(css);
  let checks = 0;
  const check = (selector, property, value) => {
    const found = [];
    root.walkRules(selector, (rule) => rule.walkDecls(property, (decl) => found.push(decl.value)));
    assert(found.includes(value), `${selector} ${property}: ${JSON.stringify(found)}`);
    checks++;
  };
  check('.text-red-500', 'color', 'rgb(var(--studio-error-rgb, 239 68 68) / var(--tw-text-opacity, 1))');
  check('.text-white', 'color', 'rgb(var(--studio-text-rgb, 255 255 255) / var(--tw-text-opacity, 1))');
  check('.bg-white', 'background-color', 'rgb(var(--studio-panel-rgb, 255 255 255) / var(--tw-bg-opacity, 1))');
  check('.text-customColor4', 'color', 'var(--studio-text, var(--color-custom4))');
  check('.bg-customColor3', 'background-color', 'var(--studio-panel, var(--color-custom3))');
  check('.bg-\\[var\\(--studio-accent\\2c \\#612BD3\\)\\]', 'background-color', 'var(--studio-accent,#612BD3)');
  root.walkDecls(/^--studio-/, (decl) => {
    assert(decl.parent.selector.includes("html[data-linkself-theme=blueprint]"), 'Blueprint tokens must be gated');
  });
  checks++;
  const fonts = fs.readdirSync('apps/frontend/src/fonts/blueprint').filter((name) => name.endsWith('.woff2'));
  assert.equal(fonts.length, 5);
  for (const name of fonts) {
    assert.equal(fs.readFileSync(`apps/frontend/src/fonts/blueprint/${name}`).subarray(0, 4).toString(), 'wOF2');
    checks++;
  }
  console.log(`Blueprint CSS/font checks: ${checks} passed, 0 failed. Sass and Tailwind compilation passed.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; });
