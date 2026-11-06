import { readFileSync } from 'fs';
import { resolve } from 'path';
import Uppy from '@uppy/core';
import { fetcher } from '@uppy/utils/lib/fetcher';
import XHRUpload from '@uppy/xhr-upload';
import {
  CHUNKED_UPLOAD_THRESHOLD,
  getUppyUploadPlugin,
  LocalChunkedUpload,
  uploadMedia,
} from '@gitroom/react/helpers/uppy.upload';

jest.mock('@uppy/utils/lib/fetcher', () => ({ fetcher: jest.fn() }));
jest.mock('@uppy/core', () =>
  (process as any).getBuiltinModule('module').createRequire(__filename)(
    '@uppy/core'
  )
);
jest.mock('@uppy/xhr-upload', () => ({
  __esModule: true,
  default: (process as any)
    .getBuiltinModule('module')
    .createRequire(__filename)('@uppy/xhr-upload').default,
}));
jest.mock('@uppy/aws-s3', () => ({ __esModule: true, default: class {} }));
jest.mock('@uppy/transloadit', () => ({ __esModule: true, default: class {} }));

const chunkSize = 4 * 1024 * 1024;
const mode = { linkselfUrl: 'https://linkself.test', storageProvider: 'local' };
const saved = {
  id: 'media-one',
  name: 'stored.png',
  path: '/uploads/stored.png',
};
const file = (size: number) =>
  new Blob([new Uint8Array(size)], { type: 'image/png' });
const json = (value: any, status = 200) =>
  new Response(JSON.stringify(value), { status });
const fetchUpload = () =>
  jest.fn(async (url: string, options: RequestInit) => {
    if (url.endsWith('/start')) return json({ uploadId: 'a'.repeat(64) });
    if (options.method === 'PUT' || options.method === 'DELETE')
      return new Response(null, { status: 204 });
    return json(saved);
  });

describe('Studio upload transport', () => {
  it('sends large files in sequential raw parts and reports progress', async () => {
    const fetch = fetchUpload();
    const onProgress = jest.fn();
    const blob = file(chunkSize * 2 + 50);
    expect(
      await uploadMedia(fetch, blob, 'original.png', { ...mode, onProgress })
    ).toEqual(saved);
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      '/media/chunked/start',
      `/media/chunked/${'a'.repeat(64)}/0`,
      `/media/chunked/${'a'.repeat(64)}/1`,
      `/media/chunked/${'a'.repeat(64)}/2`,
      `/media/chunked/${'a'.repeat(64)}/complete`,
    ]);
    expect(JSON.parse(fetch.mock.calls[0][1].body as string)).toEqual({
      name: 'original.png',
      mimeType: 'image/png',
      size: blob.size,
    });
    for (const [, request] of fetch.mock.calls.filter(
      ([, request]) => request.method === 'PUT'
    )) {
      expect(request.headers).toEqual({
        'Content-Type': 'application/octet-stream',
      });
      expect(request.body).toBeInstanceOf(Blob);
      expect((request.body as Blob).size).toBeLessThanOrEqual(chunkSize);
    }
    expect(onProgress.mock.calls).toEqual([
      [chunkSize],
      [chunkSize * 2],
      [blob.size],
    ]);
  });

  it('waits for each part before sending the next one', async () => {
    const fetch = fetchUpload();
    let release: () => void;
    let reached: () => void;
    const waiting = new Promise<void>((accept) => {
      reached = accept;
    });
    fetch.mockImplementationOnce(async () => json({ uploadId: 'upload-one' }));
    fetch.mockImplementationOnce(async () => {
      reached();
      await new Promise<void>((accept) => {
        release = accept;
      });
      return new Response(null, { status: 204 });
    });
    const upload = uploadMedia(
      fetch,
      file(chunkSize + 1),
      'original.png',
      mode
    );
    await waiting;
    expect(fetch).toHaveBeenCalledTimes(2);
    release();
    await upload;
    expect(fetch.mock.calls[2][0]).toBe('/media/chunked/upload-one/1');
  });

  it.each([CHUNKED_UPLOAD_THRESHOLD - 1, CHUNKED_UPLOAD_THRESHOLD])(
    'keeps a single request at size %s',
    async (size) => {
      const fetch = fetchUpload();
      await uploadMedia(fetch, file(size), 'small.png', {
        ...mode,
        endpoint: 'upload-server',
      });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe('/media/upload-server');
      expect(fetch.mock.calls[0][1].body).toBeInstanceOf(FormData);
    }
  );

  it.each([
    { ...mode, linkselfUrl: '' },
    { ...mode, storageProvider: 'cloudflare' },
  ])(
    'keeps editor single uploads outside local LinkSelf mode case %#',
    async (options) => {
      const fetch = fetchUpload();
      await uploadMedia(fetch, file(chunkSize + 1), 'large.png', options);
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(fetch.mock.calls[0][0]).toBe('/media/upload-simple');
    }
  );

  it.each([100, chunkSize + 1])(
    'preserves thumbnail saving at size %s',
    async (size) => {
      const fetch = fetchUpload();
      await uploadMedia(fetch, file(size), 'media.jpg', {
        ...mode,
        preventSave: true,
      });
      const last = fetch.mock.calls[fetch.mock.calls.length - 1][1];
      if (size > CHUNKED_UPLOAD_THRESHOLD) {
        expect(JSON.parse(last.body as string)).toEqual({
          partCount: 2,
          preventSave: true,
        });
      } else {
        expect((last.body as FormData).get('preventSave')).toBe('true');
      }
    }
  );

  it.each(['start', 'part', 'complete'])(
    'reports a failed %s request',
    async (step) => {
      const fetch = fetchUpload();
      const fallback = fetch.getMockImplementation();
      fetch.mockImplementation(async (url, options) => {
        if (
          (step === 'start' && url.endsWith('/start')) ||
          (step === 'part' && options.method === 'PUT') ||
          (step === 'complete' && url.endsWith('/complete'))
        )
          return json({ message: 'Upload failed' }, 400);
        return fallback(url, options);
      });
      await expect(
        uploadMedia(fetch, file(chunkSize + 1), 'large.png', mode)
      ).rejects.toThrow('Upload failed');
      expect(
        fetch.mock.calls.some(([, request]) => request.method === 'DELETE')
      ).toBe(step !== 'start');
      if (step === 'part')
        expect(
          fetch.mock.calls.some(([url]) => url.endsWith('/complete'))
        ).toBe(false);
    }
  );

  it('preserves XHRUpload without LinkSelf', () => {
    const plugin = getUppyUploadPlugin('local', fetchUpload(), '/api');
    expect(plugin.plugin).toBe(XHRUpload);
    expect(plugin.options).toEqual({
      endpoint: '/api/media/upload-server',
      withCredentials: true,
    });
    expect(
      getUppyUploadPlugin('local', fetchUpload(), '/api', [], mode.linkselfUrl)
        .plugin
    ).toBe(LocalChunkedUpload);
  });

  it('passes success and progress to Uppy', async () => {
    const fetch = fetchUpload();
    const uppy = new Uppy();
    uppy.use(LocalChunkedUpload, { fetch, linkselfUrl: mode.linkselfUrl });
    const progress = jest.fn();
    uppy.on('upload-progress', progress);
    uppy.addFile({
      name: 'large.png',
      type: 'image/png',
      data: file(chunkSize + 1),
    });
    const result = await uppy.upload();
    expect(result.successful).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.successful[0].response.body).toEqual(saved);
    expect(progress).toHaveBeenCalledTimes(2);
    uppy.destroy();
  });

  it('keeps XHR progress and request options for small Uppy files', async () => {
    const fetch = fetchUpload();
    const xhr = jest.mocked(fetcher);
    xhr.mockImplementationOnce(async (_url, options) => {
      options.onUploadProgress({
        lengthComputable: true,
        loaded: 50,
        total: 100,
      } as ProgressEvent);
      options.onUploadProgress({
        lengthComputable: true,
        loaded: 100,
        total: 100,
      } as ProgressEvent);
      return {
        status: 201,
        responseText: JSON.stringify(saved),
      } as XMLHttpRequest;
    });
    const uppy = new Uppy();
    uppy.use(LocalChunkedUpload, {
      fetch,
      linkselfUrl: mode.linkselfUrl,
      backendUrl: '/dashboard/studio/api',
    });
    const progress = jest.fn();
    uppy.on('upload-progress', progress);
    uppy.addFile({ name: 'small.png', type: 'image/png', data: file(100) });
    const result = await uppy.upload();
    expect(result.successful[0].response.body).toEqual(saved);
    expect(xhr).toHaveBeenCalledWith(
      '/dashboard/studio/api/media/upload-server',
      expect.objectContaining({
        method: 'post',
        withCredentials: true,
        timeout: 30000,
        body: expect.any(FormData),
      })
    );
    expect(progress.mock.calls.map(([, event]) => event.bytesUploaded)).toEqual(
      [50, 100]
    );
    expect(fetch).not.toHaveBeenCalled();
    uppy.destroy();
  });

  it('preserves the MIME type inferred by Uppy', async () => {
    const fetch = fetchUpload();
    const uppy = new Uppy();
    uppy.use(LocalChunkedUpload, { fetch, linkselfUrl: mode.linkselfUrl });
    uppy.addFile({
      name: 'video.mp4',
      data: new Blob([new Uint8Array(chunkSize + 1)]),
    });
    const result = await uppy.upload();
    expect(result.successful).toHaveLength(1);
    expect(JSON.parse(fetch.mock.calls[0][1].body as string).mimeType).toBe(
      'video/mp4'
    );
    uppy.destroy();
  });

  it('reports a failed file through the existing Uppy result', async () => {
    const fetch = jest.fn(async () => json({ message: 'Upload failed' }, 400));
    const uppy = new Uppy();
    uppy.use(LocalChunkedUpload, { fetch, linkselfUrl: mode.linkselfUrl });
    uppy.addFile({
      name: 'large.png',
      type: 'image/png',
      data: file(chunkSize + 1),
    });
    const result = await uppy.upload();
    expect(result.failed).toHaveLength(1);
    expect(result.successful).toHaveLength(0);
    uppy.destroy();
  });

  it('uses the shared uploader for both editor upload paths', () => {
    for (const path of [
      'apps/frontend/src/components/launches/polonto.tsx',
      'apps/frontend/src/components/launches/helpers/media.settings.component.tsx',
    ]) {
      const source = readFileSync(resolve(process.cwd(), path), 'utf8');
      expect(source).toContain('await uploadMedia(');
      expect(source).toContain('linkselfUrl, storageProvider');
      expect(source).not.toContain("fetch('/media/upload-simple'");
    }
  });
});
