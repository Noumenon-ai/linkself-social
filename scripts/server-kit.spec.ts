import { execFileSync } from 'child_process';
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
