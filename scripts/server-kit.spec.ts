import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';

const root = resolve(__dirname, '..');
const kit = join(root, 'var/docker/server');

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

function looksSecret(text: string): boolean {
  const patterns = [
    /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/,
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
    /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
    /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
    /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/,
    /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b/,
    /\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\b/,
    /(?:postgres(?:ql)?|https?):\/\/[^\s/@:]+:[^\s/@]+@/,
    /\b(?:ssh-ed25519|ssh-rsa) AAA[A-Za-z0-9+/=]{20,}/,
    // Literal assignments are forbidden; runtime interpolation and placeholders are allowed.
    /^\s*(?:export\s+)?["']?(?:[A-Z_]*(?:PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY))["']?\s*[:=]\s*["']?(?!\$|<|["']?\s*$)[A-Za-z0-9][^\s]*/m,
  ];
  return patterns.some((pattern) => pattern.test(text));
}

describe('Server deployment kit', () => {
  let model: any;
  let scratch: string;
  beforeAll(() => {
    scratch = mkdtempSync(join(root, '.server-kit-check-'));
    const envPath = join(scratch, 'dummy.env');
    writeFileSync(envPath, [
      'POSTGRES_PASSWORD=check-only-placeholder',
      'TEMPORAL_POSTGRES_PASSWORD=check-only-placeholder',
      'STUDIO_ORIGIN_HOST=origin.invalid',
      'STUDIO_IMAGE=linkself-social:check',
      '',
    ].join('\n'), { mode: 0o600 });
    // config is offline: no daemon access, image pulls, or service startup.
    model = JSON.parse(execFileSync('docker', [
      'compose', '--project-directory', root, '--env-file', envPath,
      '-p', 'linkself-server-check',
      '-f', 'docker-compose.linkself.yaml',
      '-f', 'docker-compose.linkself.local.yaml',
      '-f', 'var/docker/server/docker-compose.server.yaml',
      'config', '--format', 'json',
    ], {
      cwd: root,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'test', LINKSELF_SOCIAL_ENV: envPath },
      encoding: 'utf8',
      timeout: 30000,
    }));
  });
  afterAll(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

  it.each(['backup.sh', 'bootstrap.sh', 'common.sh', 'dc.sh', 'move-to-server.sh', 'restore.sh', 'start-after-restore.sh'])(
    '%s exists and passes Bash syntax validation', (name) => {
      expect(execFileSync('bash', ['-n', join(kit, name)], { encoding: 'utf8' })).toBe('');
    }
  );

  it('uses the wrapper in operator instructions', () => {
    const readme = readFileSync(join(kit, 'README.md'), 'utf8');
    expect(readme).not.toMatch(/(?:source|\.)\s+[^\n]*common\.sh/);
    for (const path of filesIn(kit).filter((path) => path.endsWith('.sh'))) {
      const script = readFileSync(path, 'utf8');
      for (const line of script.split('\n').filter((line) => line.includes('common.sh'))) {
        expect(line).toMatch(/^(?:# shellcheck source=|source "\$\(dirname)/);
      }
    }
  });

  it('uses source-machine and generic DNS wording throughout the kit', () => {
    for (const path of filesIn(kit)) {
      expect(readFileSync(path, 'utf8')).not.toMatch(/laptop|porkbun/i);
    }
  });

  it('gives every Compose exec explicit stdin', () => {
    const commands: string[] = [];
    for (const path of filesIn(kit).filter((path) => path.endsWith('.sh'))) {
      const script = readFileSync(path, 'utf8').replace(/\\\n\s*/g, ' ');
      for (const line of script.split('\n').filter((line) => /\bdc exec\b/.test(line))) {
        commands.push(line);
        if (line.includes('pg_restore')) expect(line).toMatch(/< "\$snapshot\/[^"\n]+\.dump"/);
        else expect(line).toContain('</dev/null');
      }
    }
    expect(commands.length).toBeGreaterThanOrEqual(7);
  });

  it.each([
    ['bare', 'CHECK_VALUE=private$dollar', 1],
    ['double quoted', 'CHECK_VALUE="private$dollar"', 1],
    ['partly quoted', "CHECK_VALUE='private$dollar'continued", 1],
    ['single quoted', "CHECK_VALUE='private$dollar'", 0],
    ['single quoted with comment', "CHECK_VALUE='private$dollar' # comment", 0],
    ['comments and blanks', '# CHECK_VALUE=private$dollar\n\nPLAIN=ordinary', 0],
    ['inline comment', 'PLAIN=ordinary # private$dollar\nEMPTY= # private$dollar', 0],
  ])('validates %s env values without displaying them', (_label, contents, status) => {
    const envPath = join(scratch, 'quoting.env');
    writeFileSync(envPath, contents + '\n', { mode: 0o600 });
    const result = spawnSync('bash', ['-c', 'source "$1"; check_env_values "$2"', 'check', join(kit, 'common.sh'), envPath], { encoding: 'utf8' });
    expect(result.status).toBe(status);
    expect(result.stdout).toBe('');
    expect(result.stderr).not.toContain('private');
    expect(result.stderr).not.toContain('$dollar');
    if (status) expect(result.stderr).toContain('Env variable CHECK_VALUE');
    else expect(result.stderr).toBe('');
    expect(readFileSync(join(kit, 'common.sh'), 'utf8')).toContain('check_env_values "$LINKSELF_SOCIAL_ENV"');
  });

  it('waits for database TCP readiness without consuming the next input line', () => {
    const result = execFileSync('bash', ['-c', `
      source "$1"
      dc() { [[ "$*" == 'exec -T database pg_isready -h 127.0.0.1 -U role -d database' ]] || exit 2; cat >/dev/null; }
      wait_database database role database
      IFS= read -r next
      printf '%s' "$next"
    `, 'check', join(kit, 'common.sh')], { encoding: 'utf8', input: 'next line\n' });
    expect(result).toBe('next line');
  });

  it('dumps every listed Temporal database even when exec reads stdin', () => {
    const snapshot = mkdtempSync(join(scratch, 'snapshot-'));
    writeFileSync(join(snapshot, 'temporal-databases'), 'temporal\ntemporal_visibility\n');
    const script = readFileSync(join(kit, 'backup.sh'), 'utf8');
    const loop = script.slice(script.indexOf('while IFS= read -r database'), script.indexOf('archive_volume postiz'));
    execFileSync('bash', ['-c', `
      source "$1"
      snapshot=$2
      dc() { cat >/dev/null; printf '%s' "$*"; }
      ${loop}
    `, 'check', join(kit, 'common.sh'), snapshot]);
    for (const database of ['temporal', 'temporal_visibility']) {
      expect(readFileSync(join(snapshot, 'temporal-' + database + '.dump'), 'utf8'))
        .toBe('exec -T temporal-postgresql pg_dump -U temporal -d ' + database + ' -Fc');
    }
  });

  it.each([true, false])('stops studio workers before the container when running (%s)', (running) => {
    const result = execFileSync('bash', ['-c', `
      source "$1"
      running=${running}
      container() { printf '%s' "$1"; }
      docker() { if [[ $* == *postiz && $running == true ]]; then echo true; else echo false; fi; }
      dc() { printf '%s\n' "$*"; if [[ $1 == exec ]]; then cat >/dev/null; fi; if [[ $1 == stop && $4 == postiz ]]; then running=false; fi; }
      stop_writers
      IFS= read -r next
      printf '%s\n' "$next"
    `, 'check', join(kit, 'common.sh')], { encoding: 'utf8', input: 'next line\n' });
    const commands = result.trim().split('\n');
    if (running) expect(commands.shift()).toBe("exec -T postiz sh -c cd /app && pnpm exec pm2 stop all");
    expect(commands).toEqual(['stop -t 15 postiz', 'stop -t 120 temporal-ui temporal', 'stop -t 120 temporal-elasticsearch postiz-redis', 'next line']);
  });

  it.each([true, false])('starts studio only after Temporal is healthy (%s)', (healthy) => {
    const script = readFileSync(join(kit, 'start-after-restore.sh'), 'utf8');
    const body = script.slice(script.indexOf('dc up'));
    const result = spawnSync('bash', ['-c', `
      source "$1"
      sleep() { :; }
      dc() {
        if [[ $1 == exec ]]; then cat >/dev/null; return ${healthy ? 0 : 1}; fi
        printf '%s\n' "$*"
      }
      ${body}
      IFS= read -r next
      printf '%s\n' "$next"
    `, 'check', join(kit, 'common.sh')], { encoding: 'utf8', input: 'next line\n' });
    expect(result.status).toBe(healthy ? 0 : 1);
    expect(result.stdout).toContain('up -d --pull never temporal-elasticsearch postiz-redis temporal temporal-ui');
    if (healthy) {
      expect(result.stdout).toContain('up -d --pull never postiz caddy');
      expect(result.stdout).toContain('next line');
    } else {
      expect(result.stdout).not.toContain('postiz caddy');
      expect(result.stderr).toContain('Temporal readiness timed out; studio has not been started.');
    }
  });

  it('publishes only Caddy TCP 80 and 443 after all three files merge', () => {
    const published = Object.entries(model.services).flatMap(([name, service]: [string, any]) =>
      (service.ports || []).map((port: any) => ({ name, published: String(port.published), target: port.target, protocol: port.protocol }))
    );
    expect(published).toEqual([
      { name: 'caddy', published: '80', target: 80, protocol: 'tcp' },
      { name: 'caddy', published: '443', target: 443, protocol: 'tcp' },
    ]);
    expect(Object.keys(model.services)).toHaveLength(8);
  });

  it('requires local images, bounded memory, and restart policies for every service', () => {
    let memory = 0;
    for (const service of Object.values(model.services) as any[]) {
      expect(service.pull_policy).toBe('never');
      expect(service.restart).toBe('unless-stopped');
      const limit = Number(service.mem_limit);
      expect(limit).toBeGreaterThan(0);
      memory += limit;
    }
    expect(memory).toBeLessThanOrEqual(6 * 1024 ** 3);
    expect(model.services.postiz.image).toBe('linkself-social:check');
    expect(model.services['temporal-elasticsearch'].environment.ES_JAVA_OPTS).toBe('-Xms256m -Xmx256m');
  });

  it('pins Caddy and retains its certificate/config storage and internal proxy', () => {
    const caddy = model.services.caddy;
    expect(caddy.image).toMatch(/^caddy:\d+\.\d+\.\d+-alpine$/);
    expect(caddy.environment.STUDIO_ORIGIN_HOST).toBe('origin.invalid');
    expect(caddy.volumes.filter((volume: any) => volume.type === 'volume').map((volume: any) => volume.target).sort()).toEqual(['/config', '/data']);
    expect(caddy.volumes.find((volume: any) => volume.target === '/etc/caddy/Caddyfile')).toMatchObject({
      read_only: true, source: join(kit, 'Caddyfile'),
    });
    expect(readFileSync(join(kit, 'Caddyfile'), 'utf8')).toContain('reverse_proxy postiz:5000');
  });

  it('replaces the development Temporal password on both services', () => {
    expect(model.services['temporal-postgresql'].environment.POSTGRES_PASSWORD).toBe('check-only-placeholder');
    expect(model.services.temporal.environment.POSTGRES_PWD).toBe('check-only-placeholder');
  });

  it('contains no credential-shaped data anywhere in the server kit', () => {
    for (const path of filesIn(kit)) {
      expect({ file: path.slice(root.length + 1), secret: looksSecret(readFileSync(path, 'utf8')) })
        .toEqual({ file: path.slice(root.length + 1), secret: false });
    }
  });

  it.each([
    '-----BEGIN OPENSSH PRIVATE KEY-----',
    'POSTGRES_PASSWORD=literal-credential',
    'JWT_SECRET: "literal-credential"',
    'https://someone:literal-credential@origin.invalid',
    'ghp_' + 'x'.repeat(36),
    'AKIA' + 'A'.repeat(16),
    'ssh-ed25519 AAA' + 'A'.repeat(32),
  ])('detects a synthetic credential fixture %s', (fixture) => {
    expect(looksSecret(fixture)).toBe(true);
  });

  it('accepts runtime references without confusing them with committed credentials', () => {
    expect(looksSecret('POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?required}\nJWT_SECRET=<private-value>')).toBe(false);
  });
});
