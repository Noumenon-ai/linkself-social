const fs = require('node:fs');
const path = require('node:path');

function renderNginx(template, value = '', linkself = process.env.LINKSELF_URL) {
  const base = value.replace(/\/+$/, '');
  if (base && !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(base)) {
    throw new Error('Invalid LINKSELF_BASE_PATH');
  }
  // Replace only our marker: nginx variables such as $host must stay intact.
  const uploads = template.match(/        location __LINKSELF_BASE_PATH__\/uploads\/ \{[\s\S]*?\n        \}/)?.[0];
  const legacy = base && uploads
    ? uploads.replace('__LINKSELF_BASE_PATH__', '').replace('            alias /uploads/;', '            alias /uploads/;\n            limit_except GET HEAD { deny all; }')
    : '';
  return template.replaceAll('__LINKSELF_BASE_PATH__', base)
    .replace('__LINKSELF_API_HEADERS__', linkself ? `proxy_hide_header X-Content-Type-Options;\n            proxy_hide_header Content-Security-Policy;\n            add_header X-Content-Type-Options "nosniff" always;\n            add_header Content-Security-Policy "default-src 'none'; sandbox" always;` : '')
    .replace('        location / {', legacy + '\n\n        location / {');
}

if (require.main === module) {
  fs.writeFileSync('/etc/nginx/nginx.conf', renderNginx(
    fs.readFileSync(path.join(__dirname, 'nginx.conf'), 'utf8'),
    process.env.LINKSELF_BASE_PATH
  ));
}

module.exports = { renderNginx };
