// Static path audit. Uses the installed TypeScript parser so multiline JSX and
// template literals cannot evade the grep-style check. No app/build is started.
const fs = require('node:fs');
const cp = require('node:child_process');
const ts = require('typescript');

// Exceptions are semantic, not blanket file exclusions:
const exceptions = {
  helper: 'The path helper owns URL prefixes and cookie paths.',
  next: 'Next Link/router/server redirect, Redirect and navigateOrShow apply basePath themselves.',
  fetchBase: 'useFetch/internalFetch routes are relative to the configured API base.',
  cache: 'SWR keys are cache identifiers, not browser URLs.',
  compare: 'Route comparisons inspect Next usePathname/nextUrl without basePath.',
  delimiter: 'Slash delimiters, MIME types and Telegram commands are not URLs.',
  navigation: 'top.menu and studio.tabs path data is consumed by Next Link.',
  matcher: 'Next applies basePath to the proxy matcher and config routes.',
  concat: 'Suffix appended to a configured public frontend/API URL.',
  filesystem: 'Upload paths and local font imports are filesystem paths.',
  protocol: 'MCP OAuth discovery uses RFC origin-root paths; path deployments use API-key MCP or a separately routed MCP_URL. SDK HTTP routing sees paths stripped by nginx.',
  backend: 'Backend decorators and provider API paths are internal routes, not browser URLs; public URL construction is checked separately.',
};
const roots = ['apps/frontend/src', 'libraries/helpers/src', 'libraries/react-shared-libraries/src'];
const files = cp.execFileSync('git', ['ls-files', ...roots], { encoding: 'utf8' })
  .trim().split('\n').filter(f => /\.(tsx?|s?css)$/.test(f) && !/\.(spec|test)\.ts$/.test(f));
const failures = [];
const counts = {};
// Indirect consumers reviewed explicitly; a new path in these files still fails.
const indirect = [
  ['components/analytics/stars.table.component.tsx', '`/launches?week=${weekNumber}&year=${year}`', 'next'],
  ['components/admin/admin-errors.component.tsx', '`/admin/errors?${query.toString()}`', 'cache'],
  ['components/admin/admin-stats.component.tsx', '`/admin/stats?${query.toString()}`', 'cache'],
  ['components/new-launch/providers/reddit/subreddit.tsx', '"/r/selfhosted"', 'delimiter'],
];
function allow(reason) { counts[reason] = (counts[reason] || 0) + 1; return true; }
for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  if (/base-path\.ts$/.test(file)) { allow('helper'); continue; }
  if (/\.s?css$/.test(file)) {
    source.split('\n').forEach((line, i) => {
      if (!line.trim().startsWith('//') && /url\(\s*['"]?\/(?!\/)/.test(line)) failures.push(`${file}:${i + 1}: raw CSS URL`);
    });
    continue;
  }
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function exempt(node, value) {
    if (value === '/*' || value.startsWith('/connect ') || /^\/ (month|year)$/.test(value)) return allow('delimiter');
    const known = indirect.find(([suffix, text]) => file.endsWith(suffix) && node.getText(sf) === text);
    if (known) return allow(known[2]);
    for (let p = node.parent; p && !ts.isStatement(p); p = p.parent) {
      if (ts.isCallExpression(p)) {
        const call = p.expression.getText(sf);
        if (['withBasePath', 'linkselfPath', 'frontendUrl'].includes(call)) return allow('helper');
        if (call === 'redirect' && /from 'next\/navigation'/.test(source)) return allow('next');
        if (call === 'useSWR' || call === 'mutate') return allow('cache');
        if (['internalFetch', 'fetchBackend'].includes(call) ||
            (['fetch', 'fetchData', 'newFetch', 'fetchDataPub', 'this.opts.fetch'].includes(call) &&
             /useFetch|customFetch|fetch: any/.test(source))) return allow('fetchBase');
        if (/^(router\.(push|replace)|push|replace|navigateOrShow)$/.test(call) && /useRouter/.test(source)) return allow('next');
        if (call === 'gotoUrl' && file.endsWith('/add.provider.component.tsx')) return allow('next');
        if (/\.(startsWith|includes|indexOf|split|replace|join|endsWith)$/.test(call)) return allow('compare');
      }
      if (ts.isBinaryExpression(p)) {
        if ([ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(p.operatorToken.kind)) return allow('compare');
        if (p.operatorToken.kind === ts.SyntaxKind.PlusToken && /^(backendUrl|frontEndUrl|process.env.BACKEND_INTERNAL_URL)/.test(p.left.getText(sf))) return allow('concat');
      }
      if (ts.isJsxAttribute(p) && ['href', 'url'].includes(p.name.getText(sf)) &&
          ['Link', 'Redirect'].includes(p.parent.parent.tagName?.getText(sf))) return allow('next');
      if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'path' && /\/(top.menu|studio.tabs)\.tsx$/.test(file)) return allow('navigation');
      if (ts.isPropertyAssignment(p) && p.name.getText(sf) === 'matcher' && file.endsWith('/proxy.ts')) return allow('matcher');
      if (ts.isVariableDeclaration(p) && p.name.getText(sf) === 'endpoint' && file.endsWith('/continue.integration.tsx')) return allow('fetchBase');
    }
    return false;
  }
  function visit(node) {
    if (ts.isStringLiteralLike(node) && /url\(['"]?\/(?!\/)/.test(node.text)) {
      failures.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: raw CSS URL in a string`);
    }
    if (ts.isTemplateExpression(node)) {
      // Inline script/CSS templates can hide quoted browser paths in their text.
      for (const chunk of [node.head.text, ...node.templateSpans.map(span => span.literal.text)]) {
        if (/['"]\/(?!\/)[A-Za-z][^\s'"]*['"]|url\(['"]?\/(?!\/)/.test(chunk)) {
          failures.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: raw path inside embedded script/style`);
        }
      }
    }
    const value = ts.isStringLiteralLike(node) ? node.text : ts.isTemplateExpression(node) ? node.head.text : '';
    if (/^\/(?!\/)/.test(value) && !exempt(node, value)) {
      const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
      failures.push(`${file}:${line}: ${node.getText(sf).replace(/\s+/g, ' ').slice(0, 140)}`);
    }
    ts.forEachChild(node, visit);
  }
  visit(sf);
}
const backendFiles = cp.execFileSync('rg', ['--files', 'apps/backend/src', 'libraries/nestjs-libraries/src'], { encoding: 'utf8' })
  .trim().split('\n').filter(f => /\.ts$/.test(f) && !/\.(spec|test)\.ts$/.test(f) && !/workflow|activit/.test(f));
const rawPublicBase = /process\??\.env\??\.(?:FRONTEND_URL|NEXT_PUBLIC_BACKEND_URL)|process\.env\[['"](?:FRONTEND_URL|NEXT_PUBLIC_BACKEND_URL)['"]\]/;
for (const file of backendFiles) {
  const source = fs.readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    let raw = false;
    if (ts.isTemplateExpression(node)) {
      raw = node.templateSpans.some(span => rawPublicBase.test(span.expression.getText(sf)) && !/frontendUrl\(|publicApiUrl\(/.test(span.expression.getText(sf)));
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      raw = [node.left, node.right].some(side => rawPublicBase.test(side.getText(sf)) && !/frontendUrl\(|publicApiUrl\(/.test(side.getText(sf)));
    }
    if (ts.isNewExpression(node) && node.expression.getText(sf) === 'URL' && node.arguments?.length === 2 && rawPublicBase.test(node.arguments[1].getText(sf))) {
      if (file.endsWith('/chat/start.mcp.ts') && /NEXT_PUBLIC_BACKEND_URL/.test(node.arguments[1].getText(sf))) allow('protocol');
      else raw = true;
    }
    if (ts.isCallExpression(node) && /\.redirect$/.test(node.expression.getText(sf))) {
      raw = raw || node.arguments.some(arg => ts.isStringLiteralLike(arg) && /^\/(?!\/)/.test(arg.text));
    }
    if (raw) failures.push(`${file}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}: public URL bypasses the path helper`);
    ts.forEachChild(node, visit);
  }
  visit(sf);
}
counts.backend = backendFiles.length;
for (const [reason, count] of Object.entries(counts)) console.log(`Exception (${count}): ${exceptions[reason]}`);
if (failures.length) {
  console.error(failures.join('\n'));
  console.error(`FAIL: ${failures.length} unhandled internal paths`);
  process.exitCode = 1;
} else {
  console.log(`PASS: ${files.length + backendFiles.length} files checked; 0 unhandled internal paths`);
}
