const {
  UPLOAD_COLUMNS,
  validateOrigin,
  validateTarget,
  parseArguments,
  replaceUploadOrigin,
  migrateUploadOrigin,
} = require('./migrate-upload-origin.cjs');
import { Prisma } from '@prisma/client';

const from = 'https://old.example.com';
const to = 'https://new.example.com';
describe('Upload address migration', () => {
  it.each([
    'https://other.example.com/uploads/image.png',
    'https://old.example.com.evil.test/uploads/image.png',
    'https://old.example.com@evil.test/uploads/image.png',
    'https://other.example.com/path/https://old.example.com/uploads/image.png',
    'https://old.example.com/files/image.png',
    '/uploads/image.png',
  ])('leaves unrelated URL %s untouched', (value) => {
    expect(replaceUploadOrigin(value, from, to)).toBe(value);
  });
  it('replaces every exact upload prefix in JSON and HTML content', () => {
    const value = JSON.stringify({
      path: from + '/uploads/a.png',
      thumbnail: from + '/uploads/b.png',
      content: `<img src="${from}/uploads/c.png">`,
      other: 'https://other.example.com/uploads/x.png',
    });
    const result = JSON.parse(replaceUploadOrigin(value, from, to));
    expect(result.path).toBe(to + '/uploads/a.png');
    expect(result.thumbnail).toBe(to + '/uploads/b.png');
    expect(result.content).toBe(`<img src="${to}/uploads/c.png">`);
    expect(result.other).toBe('https://other.example.com/uploads/x.png');
  });
  it('is safe to run twice', () => {
    const result = replaceUploadOrigin(from + '/uploads/a.png', from, to);
    expect(replaceUploadOrigin(result, from, to)).toBe(result);
    expect(replaceUploadOrigin(result, to, to)).toBe(result);
  });
  it.each([
    'file:///tmp',
    'javascript:alert(1)',
    'https://user:pass@example.com',
    'https://example.com/studio',
    'https://example.com?query',
    'https://example.com#fragment',
    '',
    undefined,
  ])('rejects invalid origin %s', (value) => {
    expect(() => validateOrigin(value)).toThrow();
  });
  it.each([
    'https://linkself.net/dashboard/studio',
    'https://linkself.net/dashboard/studio/',
    from + '/dashboard/studio',
    from + '/dashboard/studio/',
    from + '/uploads/archive',
  ])('replaces uploads with the path target %s and remains unchanged on a second run', (target) => {
    const normalized = target.replace(/\/$/, '');
    expect(parseArguments([`--from=${from}`, `--to=${target}`]).to).toBe(normalized);
    const content = JSON.stringify({ path: from + '/uploads/a.png', html: `<img src="${from}/uploads/b.png">` });
    const result = replaceUploadOrigin(content, from, target);
    expect(JSON.parse(result)).toEqual({ path: normalized + '/uploads/a.png', html: `<img src="${normalized}/uploads/b.png">` });
    expect(replaceUploadOrigin(result, from, target)).toBe(result);
  });
  it('accepts plain segments and can undo a path rewrite', () => {
    expect(validateTarget(to + '/A-z_9.~')).toBe(to + '/A-z_9.~');
    const content = JSON.stringify({ path: from + '/uploads/a.png', other: to + '/studio/a.png' });
    const moved = replaceUploadOrigin(content, from, to + '/studio');
    expect(parseArguments([`--from=${to}/studio`, `--to=${from}`]).from).toBe(to + '/studio');
    expect(replaceUploadOrigin(moved, to + '/studio', from)).toBe(content);
  });
  it.each([
    to + '/dashboard/../studio',
    to + '/dashboard/./studio',
    to + '/dashboard/%2e%2e/studio',
    to + '/dashboard/studio?query=1',
    to + '/dashboard/studio?',
    to + '/dashboard/studio#fragment',
    to + '/dashboard/studio#',
    'https://user:pass@example.com/studio',
    'https://user@example.com/studio',
    'ftp://example.com/studio',
    to + '/dashboard//studio',
    to + '/dashboard/studio//',
    to + '/dashboard/a b',
    to + '/dashboard/with%20space',
    to + '/dashboard/with:colon',
    to + '/dashboard/with\\slash',
    to + '/studio\n',
  ])('refuses unsupported target %s', (target) => {
    expect(() => parseArguments([`--from=${from}`, `--to=${target}`])).toThrow('--from and --to must be');
    expect(() => parseArguments([`--from=${target}`, `--to=${from}`])).toThrow('--from and --to must be');
  });
  it('defaults to dry run and requires explicit origins', () => {
    expect(parseArguments([`--from=${from}`, `--to=${to}/`])).toEqual({
      from,
      to,
      apply: false,
    });
    expect(
      parseArguments([`--from=${from}`, `--to=${to}`, '--apply']).apply
    ).toBe(true);
    expect(() => parseArguments(['--apply'])).toThrow();
    expect(() =>
      parseArguments([`--from=${from}`, `--to=${to}`, '--unknown'])
    ).toThrow();
  });
  it('only targets existing Prisma text columns with IDs', () => {
    for (const [delegate, columns] of Object.entries(UPLOAD_COLUMNS)) {
      const model = Prisma.dmmf.datamodel.models.find(
        (m) => m.name[0].toLowerCase() + m.name.slice(1) === delegate
      )!;
      expect(model.fields.some((f) => f.name === 'id' && f.isId)).toBe(true);
      for (const column of columns as string[])
        expect(model.fields.find((f) => f.name === column)?.type).toBe(
          'String'
        );
    }
  });
  it.each([false, true])(
    'processes batches and reports counts only (apply=%s)',
    async (apply) => {
      const client: any = {};
      for (const model of Object.keys(UPLOAD_COLUMNS))
        client[model] = {
          findMany: jest.fn().mockResolvedValue([]),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        };
      client.media.findMany
        .mockResolvedValueOnce([{ id: 'one', path: from + '/uploads/a.png' }])
        .mockResolvedValueOnce([{ id: 'two', path: from + '/uploads/b.png' }]);
      const log = jest.fn();
      const result = await migrateUploadOrigin(
        client,
        { from, to, apply },
        log
      );
      expect(result['media.path']).toEqual({
        matched: 2,
        updated: apply ? 2 : 0,
        conflicted: 0,
      });
      expect(client.media.updateMany).toHaveBeenCalledTimes(apply ? 2 : 0);
      expect(client.media.findMany).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          take: 200,
          where: { path: { contains: from + '/uploads/' }, id: { gt: 'one' } },
          select: { id: true, path: true },
        })
      );
      if (apply)
        expect(client.media.updateMany).toHaveBeenCalledWith({
          where: { id: 'one', path: from + '/uploads/a.png' },
          data: { path: to + '/uploads/a.png' },
        });
      expect(JSON.stringify(log.mock.calls)).not.toContain('example.com');
    }
  );
  it.each([to, to + '/dashboard/studio', from + '/dashboard/studio', from + '/uploads/archive'])('processes all batches and changes nothing on a second run to %s', async (to) => {
    const rows = Array.from({ length: 405 }, (_, index) => ({
      id: String(index).padStart(4, '0'),
      path: from + `/uploads/${index}.png`,
    }));
    const client: any = {};
    for (const model of Object.keys(UPLOAD_COLUMNS))
      client[model] = {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn(),
      };
    client.media.findMany.mockImplementation(async ({ where, take }: any) => {
      if (!where.path) return [];
      return rows
        .filter(
          (row) =>
            row.path.includes(where.path.contains) &&
            (!where.id || row.id > where.id.gt)
        )
        .slice(0, take)
        .map((row) => ({ ...row }));
    });
    client.media.updateMany.mockImplementation(async ({ where, data }: any) => {
      const row = rows.find(
        (row) => row.id === where.id && row.path === where.path
      );
      if (!row) return { count: 0 };
      row.path = data.path;
      return { count: 1 };
    });
    const first = await migrateUploadOrigin(
      client,
      { from, to, apply: true },
      jest.fn()
    );
    expect(first['media.path']).toEqual({
      matched: 405,
      updated: 405,
      conflicted: 0,
    });
    expect(rows.every((row) => row.path.startsWith(to + '/uploads/'))).toBe(
      true
    );
    const second = await migrateUploadOrigin(
      client,
      { from, to, apply: true },
      jest.fn()
    );
    expect(second['media.path']).toEqual({
      matched: 0,
      updated: 0,
      conflicted: 0,
    });
    expect(client.media.updateMany).toHaveBeenCalledTimes(405);
  });

  it('reports a concurrent edit without overwriting it', async () => {
    const client: any = {};
    for (const model of Object.keys(UPLOAD_COLUMNS))
      client[model] = {
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      };
    client.media.findMany.mockResolvedValueOnce([
      { id: 'one', path: from + '/uploads/a.png' },
    ]);
    const result = await migrateUploadOrigin(
      client,
      { from, to, apply: true },
      jest.fn()
    );
    expect(result['media.path']).toEqual({
      matched: 1,
      updated: 0,
      conflicted: 1,
    });
  });
});
