import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from 'fs/promises';
import { resolve } from 'path';
import { Readable } from 'stream';
import { validate } from 'class-validator';
import { GET } from '@gitroom/frontend/app/(app)/api/uploads/[[...path]]/route';
import { MediaController } from './media.controller';
import { MediaService } from '@gitroom/nestjs-libraries/database/prisma/media/media.service';
import { LocalStorage } from '@gitroom/nestjs-libraries/upload/local.storage';
import { UploadFactory } from '@gitroom/nestjs-libraries/upload/upload.factory';
import {
  MulterStreamEngine,
  streamUploadOptions,
} from '@gitroom/nestjs-libraries/upload/multer.stream.engine';
import { StartChunkedUploadDto } from '@gitroom/nestjs-libraries/dtos/media/chunked.upload.dto';
import {
  UPLOAD_ALLOWED_MIME,
  getMaxSize,
} from '@gitroom/nestjs-libraries/upload/custom.upload.validation';

// Load the installed ESM implementation through Node for the streaming checks.
jest.mock('file-type', () =>
  (process as any).getBuiltinModule('module').createRequire(__filename)(
    'file-type'
  )
);
jest.mock('@gitroom/nestjs-libraries/upload/r2.uploader', () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock('@gitroom/nestjs-libraries/upload/upload.factory', () => ({
  UploadFactory: {
    createStorage: jest.fn(
      () =>
        new (require('@gitroom/nestjs-libraries/upload/local.storage').LocalStorage)(
          process.env.UPLOAD_DIRECTORY
        )
    ),
    createProcessor: () => null,
  },
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/media/media.repository',
  () => ({ MediaRepository: class {} })
);
jest.mock('@gitroom/nestjs-libraries/redis/redis.service', () => ({
  ioRedis: {},
}));
jest.mock('@gitroom/nestjs-libraries/openai/openai.service', () => ({
  OpenaiService: class {},
}));
jest.mock(
  '@gitroom/nestjs-libraries/database/prisma/subscriptions/subscription.service',
  () => ({ SubscriptionService: class {} })
);
jest.mock('nestjs-temporal-core', () => ({ TemporalService: class {} }));
jest.mock(
  '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher',
  () => ({ ssrfSafeDispatcher: {} })
);

const env = { ...process.env };
const org = { id: 'org-one' } as any;
const otherOrg = { id: 'org-two' } as any;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
  'base64'
);
const partSize = 4 * 1024 * 1024;

describe('Local chunked media uploads', () => {
  let folder: string;
  let controller: MediaController;
  let service: MediaService;
  let saved: jest.Mock;
  let storage: LocalStorage;

  beforeEach(async () => {
    folder = await mkdtemp(resolve(process.cwd(), '.media-chunked-test-'));
    process.env.UPLOAD_DIRECTORY = folder;
    process.env.FRONTEND_URL = 'https://studio.test/dashboard/studio';
    process.env.LINKSELF_BASE_PATH = '/dashboard/studio';
    process.env.LINKSELF_URL = 'https://linkself.test';
    process.env.STORAGE_PROVIDER = 'local';
    saved = jest.fn(async (_org, name, path, originalName) => ({
      id: 'media-one',
      name,
      path,
      originalName,
    }));
    service = new MediaService(
      { saveFile: saved } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    controller = new MediaController(service, {} as any);
    storage = new LocalStorage(folder);
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
    process.env = { ...env };
    jest.restoreAllMocks();
  });

  const details = (size = png.length) => ({
    name: 'original.png',
    size,
    mimeType: 'image/png',
  });
  const start = async (size = png.length) =>
    (await controller.startChunkedUpload(org, details(size))).uploadId;
  const part = async (
    id: string,
    index: number | string,
    bytes: Buffer = png,
    owner = org
  ) =>
    controller.uploadChunk(
      owner,
      id,
      String(index),
      Readable.from([bytes]) as any
    );
  const complete = async (id: string, partCount = 1, owner = org) =>
    controller.completeChunkedUpload(owner, id, { partCount });
  const temporary = (id: string) => resolve(folder, '.chunked', id);
  const expectRemoved = async (id: string) =>
    expect(stat(temporary(id))).rejects.toMatchObject({ code: 'ENOENT' });
  const bytesAt = (url: string) =>
    readFile(resolve(folder, url.split('/uploads/')[1]));

  it('saves the same bytes and metadata as a single streamed upload', async () => {
    const bytes = Buffer.concat([png, Buffer.alloc(partSize + 50)]);
    const id = await start(bytes.length);
    expect(id).toMatch(/^[a-f0-9]{64}$/);
    await part(id, 1, bytes.subarray(partSize));
    await part(id, 0, bytes.subarray(0, partSize));
    const chunked: any = await complete(id, 2);
    const file = await new Promise<Express.Multer.File>((accept, reject) => {
      new MulterStreamEngine(storage)._handleFile(
        {} as any,
        {
          stream: Readable.from([bytes]),
          originalname: 'original.png',
        } as any,
        (err, value) =>
          err ? reject(err) : accept(value as Express.Multer.File)
      );
    });
    const single: any = await controller.uploadServer(org, file);
    expect(
      (await bytesAt(chunked.path)).equals(await bytesAt(single.path))
    ).toBe(true);
    expect(chunked).toEqual({
      ...single,
      name: chunked.name,
      path: chunked.path,
    });
    expect(saved).toHaveBeenCalledTimes(2);
    await expectRemoved(id);
  });

  it('keeps the sanitized original name and detected extension', async () => {
    const { uploadId } = await controller.startChunkedUpload(org, {
      ...details(),
      name: 'folder/name.other',
    });
    await part(uploadId, 0);
    await complete(uploadId);
    expect(saved.mock.calls[0][3]).toBe('folder_name.png');
  });

  it.each([...UPLOAD_ALLOWED_MIME])(
    'accepts declared type %s',
    async (mimeType) => {
      await expect(
        controller.startChunkedUpload(org, { ...details(), mimeType })
      ).resolves.toHaveProperty('uploadId');
    }
  );

  it.each([
    { name: '' },
    { name: 42 },
    { size: 0 },
    { size: -1 },
    { size: 1.5 },
    { size: getMaxSize('image/png') + 1 },
    { mimeType: 'text/plain' },
    { mimeType: 'video/mp4', size: streamUploadOptions().limits.fileSize },
  ])('refuses invalid start details case %#', async (change) => {
    await expect(
      controller.startChunkedUpload(org, { ...details(), ...change } as any)
    ).rejects.toThrow();
    expect(saved).not.toHaveBeenCalled();
  });

  it('validates the start DTO', async () => {
    expect(
      await validate(Object.assign(new StartChunkedUploadDto(), details()))
    ).toHaveLength(0);
    expect(
      (
        await validate(
          Object.assign(new StartChunkedUploadDto(), {
            name: '',
            size: -1,
            mimeType: 'text/plain',
          })
        )
      ).length
    ).toBe(3);
  });

  it('uses the same maximum video size as single uploads', async () => {
    await expect(
      controller.startChunkedUpload(org, {
        name: 'video.mp4',
        mimeType: 'video/mp4',
        size: streamUploadOptions().limits.fileSize - 1,
      })
    ).resolves.toHaveProperty('uploadId');
  });

  it.each(['missing', 'extra', 'size mismatch'])(
    'refuses %s on completion and removes the temporary folder',
    async (kind) => {
      const id = await start(png.length * 2);
      await part(id, 0);
      if (kind === 'extra') await part(id, 1);
      await expect(complete(id, kind === 'missing' ? 2 : 1)).rejects.toThrow();
      await expectRemoved(id);
      expect(saved).not.toHaveBeenCalled();
    }
  );

  it('refuses an oversized part and removes the temporary folder', async () => {
    const id = await start(partSize + 1);
    await expect(part(id, 0, Buffer.alloc(partSize + 1))).rejects.toThrow(
      'File is too large'
    );
    await expectRemoved(id);
  });

  it('refuses parts exceeding the declared total and removes the temporary folder', async () => {
    const id = await start();
    await expect(part(id, 0, Buffer.concat([png, png]))).rejects.toThrow(
      'Invalid upload size'
    );
    await expectRemoved(id);
  });

  it.each(['-1', '1.2', '256', '10000', '../0'])(
    'refuses invalid part index case %#',
    async (index) => {
      const id = await start();
      await expect(part(id, index)).rejects.toThrow('Invalid part index');
      await expectRemoved(id);
    }
  );

  it.each([0, -1, 257, 1.5, '1'])(
    'refuses invalid part count case %#',
    async (partCount) => {
      const id = await start();
      await part(id, 0);
      await expect(complete(id, partCount as number)).rejects.toThrow();
      await expectRemoved(id);
    }
  );

  it('refuses a duplicate part and cleans the upload', async () => {
    const id = await start(png.length * 2);
    await part(id, 0);
    await expect(part(id, 0)).rejects.toThrow();
    await expectRemoved(id);
  });

  it('refuses an interrupted part and cleans the upload', async () => {
    const id = await start();
    const stream = Readable.from(
      (async function* () {
        yield png.subarray(0, 10);
        throw new Error('Upload interrupted');
      })()
    );
    await expect(
      controller.uploadChunk(org, id, '0', stream as any)
    ).rejects.toThrow('Upload interrupted');
    await expectRemoved(id);
  });

  it('refuses unsupported content on completion and cleans the upload', async () => {
    const bytes = Buffer.alloc(100);
    const id = await start(bytes.length);
    await part(id, 0, bytes);
    await expect(complete(id)).rejects.toThrow('Unsupported file type');
    await expectRemoved(id);
    expect(saved).not.toHaveBeenCalled();
  });

  it('enforces the detected content size limit', async () => {
    const bytes = Buffer.concat([png, Buffer.alloc(10 * 1024 * 1024)]);
    const { uploadId } = await controller.startChunkedUpload(org, {
      name: 'video.mp4',
      mimeType: 'video/mp4',
      size: bytes.length,
    });
    for (let index = 0; index < 3; index++)
      await part(
        uploadId,
        index,
        bytes.subarray(index * partSize, (index + 1) * partSize)
      );
    await expect(complete(uploadId, 3)).rejects.toThrow('File is too large');
    await expectRemoved(uploadId);
  });

  it('refuses another organization without removing the original upload', async () => {
    const id = await start();
    await expect(part(id, 0, png, otherOrg)).rejects.toThrow(
      'Upload not found'
    );
    await expect(complete(id, 1, otherOrg)).rejects.toThrow('Upload not found');
    await expect(controller.abortChunkedUpload(otherOrg, id)).rejects.toThrow(
      'Upload not found'
    );
    await part(id, 0);
    await expect(complete(id)).resolves.toHaveProperty('id');
  });

  it.each([
    'unknown',
    'a'.repeat(64),
    '../upload',
    'folder/upload',
    'folder\\upload',
  ])('refuses an unknown or invalid upload id case %#', async (id) => {
    await expect(part(id, 0)).rejects.toThrow();
    await expect(complete(id)).rejects.toThrow();
  });

  it('removes uploads older than 24 hours when a new one starts', async () => {
    const stale = await start();
    const recent = await start();
    const oldDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(resolve(temporary(stale), 'metadata.json'), oldDate, oldDate);
    const fresh = await start();
    await expectRemoved(stale);
    expect(await readdir(resolve(folder, '.chunked'))).toEqual(
      expect.arrayContaining([recent, fresh])
    );
  });

  it('refuses expired uploads and cleans their parts', async () => {
    const id = await start();
    const path = resolve(temporary(id), 'metadata.json');
    const data = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(
      path,
      JSON.stringify({ ...data, createdAt: Date.now() - 25 * 60 * 60 * 1000 })
    );
    await expect(part(id, 0)).rejects.toThrow('Upload expired');
    await expectRemoved(id);
  });

  it('keeps temporary files private', async () => {
    const id = await start();
    await part(id, 0);
    expect((await stat(temporary(id))).mode & 0o777).toBe(0o700);
    expect((await stat(resolve(temporary(id), '0.part'))).mode & 0o777).toBe(
      0o600
    );
  });

  it('removes temporary files when cancelled', async () => {
    const id = await start();
    await part(id, 0);
    await controller.abortChunkedUpload(org, id);
    await expectRemoved(id);
  });

  it('preserves preventSave for editor thumbnails', async () => {
    const id = await start();
    await part(id, 0);
    const result = await controller.completeChunkedUpload(org, id, {
      partCount: 1,
      preventSave: true,
    });
    expect(Object.keys(result)).toEqual(['path']);
    expect(await bytesAt(result.path)).toEqual(png);
    expect(saved).not.toHaveBeenCalled();
    await expectRemoved(id);
  });

  it('removes the stored file when saving the record fails', async () => {
    const id = await start();
    await part(id, 0);
    saved.mockRejectedValueOnce(new Error('Save failed'));
    await expect(complete(id)).rejects.toThrow('Save failed');
    await expectRemoved(id);
    await expect(bytesAt(saved.mock.calls[0][2])).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('keeps single uploads available without LinkSelf and refuses chunked requests', async () => {
    const id = await start();
    delete process.env.LINKSELF_URL;
    await expect(start()).rejects.toThrow('unavailable');
    await expect(part(id, 0)).rejects.toThrow('unavailable');
    await expect(complete(id)).rejects.toThrow('unavailable');
    await expect(
      controller.uploadServer(org, {
        filename: 'stored.png',
        path: '/uploads/stored.png',
        originalname: 'original.png',
      } as any)
    ).resolves.toHaveProperty('id');
  });

  it('refuses chunked uploads for a provider without local support', async () => {
    jest.spyOn(UploadFactory, 'createStorage').mockReturnValueOnce({} as any);
    const other = new MediaService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any
    );
    expect(() => other.startChunkedUpload(org.id, details())).toThrow(
      'unavailable'
    );
  });

  it.each(
    [
      ['.chunked'],
      ['.chunked', 'upload', 'metadata.json'],
      ['.chunked', 'upload', '0.part'],
      ['public', '..', '.chunked', 'upload', '0.part'],
    ].map((path) => ({ path }))
  )('does not serve temporary files through Next case %#', async ({ path }) => {
    const response = await GET(
      new Request('https://studio.test/uploads/file') as any,
      { params: Promise.resolve({ path }) }
    );
    expect(response.status).toBe(404);
  });

  it('continues to serve completed uploads through Next', async () => {
    const id = await start();
    await part(id, 0);
    const result = await complete(id);
    const path = result.path.split('/uploads/')[1].split('/');
    const response = await GET(
      new Request('https://studio.test/uploads/file') as any,
      { params: Promise.resolve({ path }) }
    );
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(png)).toBe(true);
  });

  it('blocks the temporary upload directory in nginx before the public alias', async () => {
    const nginx = await readFile(
      resolve(process.cwd(), 'var/docker/nginx.conf'),
      'utf8'
    );
    expect(nginx).toMatch(
      /location = __LINKSELF_BASE_PATH__\/uploads\/\.chunked\s*\{\s*return 404;/
    );
    expect(nginx).toMatch(
      /location \^~ __LINKSELF_BASE_PATH__\/uploads\/\.chunked\/\s*\{\s*return 404;/
    );
    const {
      renderNginx,
    } = require('../../../../../var/docker/render-nginx.cjs');
    for (const base of ['', '/dashboard/studio']) {
      const rendered = renderNginx(nginx, base);
      for (const mount of new Set(['', base])) {
        expect(rendered).toContain(
          `location = ${mount}/uploads/.chunked {\n            return 404;`
        );
        expect(rendered).toContain(
          `location ^~ ${mount}/uploads/.chunked/ {\n            return 404;`
        );
      }
    }
  });
});
