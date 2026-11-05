const fs = require('node:fs');
const path = require('node:path');

function renderNginx(template, value = '') {
  const base = value.replace(/\/+$/, '');
  if (base && !/^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(base)) {
    throw new Error('Invalid LINKSELF_BASE_PATH');
  }
  // Replace only our marker: nginx variables such as $host must stay intact.
  return template.replaceAll('__LINKSELF_BASE_PATH__', base);
}

if (require.main === module) {
  fs.writeFileSync('/etc/nginx/nginx.conf', renderNginx(
    fs.readFileSync(path.join(__dirname, 'nginx.conf'), 'utf8'),
    process.env.LINKSELF_BASE_PATH
  ));
}

module.exports = { renderNginx };
