import XHRUpload from '@uppy/xhr-upload';
import AwsS3Multipart from '@uppy/aws-s3';
import sha256 from 'sha256';
import Transloadit from '@uppy/transloadit';
import { BasePlugin } from '@uppy/core';
import { fetcher } from '@uppy/utils/lib/fetcher';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const CHUNKED_UPLOAD_THRESHOLD = 3.5 * 1024 * 1024;
const CHUNK_SIZE = 4 * 1024 * 1024;

export async function uploadMedia(
  fetch: any,
  file: Blob,
  name: string,
  options: {
    linkselfUrl?: string;
    storageProvider: string;
    endpoint?: 'upload-simple' | 'upload-server';
    preventSave?: boolean;
    mimeType?: string;
    signal?: AbortSignal;
    onProgress?: (bytes: number) => void;
  }
) {
  const newFetch = async (url: string, init: RequestInit) => {
    const response = await fetch(url, { ...init, signal: options.signal });
    if (!response.ok)
      throw new Error(await response.text().catch(() => 'Upload failed'));
    return response;
  };
  if (
    !options.linkselfUrl ||
    options.storageProvider !== 'local' ||
    file.size <= CHUNKED_UPLOAD_THRESHOLD
  ) {
    const formData = new FormData();
    formData.append('file', file, name);
    if (options.preventSave) formData.append('preventSave', 'true');
    const response = await newFetch(
      `/media/${options.endpoint || 'upload-simple'}`,
      {
        method: 'POST',
        body: formData,
      }
    );
    options.onProgress?.(file.size);
    return response.json();
  }

  const { uploadId } = await (
    await newFetch('/media/chunked/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        size: file.size,
        mimeType: options.mimeType || file.type,
      }),
    })
  ).json();
  try {
    const partCount = Math.ceil(file.size / CHUNK_SIZE);
    for (let index = 0; index < partCount; index++) {
      const end = Math.min(file.size, (index + 1) * CHUNK_SIZE);
      await newFetch(`/media/chunked/${uploadId}/${index}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file.slice(index * CHUNK_SIZE, end),
      });
      options.onProgress?.(end);
    }
    return await (
      await newFetch(`/media/chunked/${uploadId}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ partCount, preventSave: !!options.preventSave }),
      })
    ).json();
  } catch (err) {
    await fetch(`/media/chunked/${uploadId}`, { method: 'DELETE' }).catch(
      () => {}
    );
    throw err;
  }
}

export class LocalChunkedUpload extends BasePlugin<any, any, any> {
  private requests = new Map<string, AbortController>();
  private singleUpload: XHRUpload<any, any>;

  constructor(uppy: any, opts: any) {
    super(uppy, opts);
    this.id = 'LocalChunkedUpload';
    this.type = 'uploader';
    this.singleUpload = new XHRUpload(uppy, {
      endpoint: `${opts.backendUrl}/media/upload-server`,
      withCredentials: true,
    });
  }

  upload = async (fileIDs: string[]) => {
    for (const id of fileIDs) {
      const file = this.uppy.getFile(id);
      if (!file || file.error || file.progress.uploadComplete) continue;
      const controller = new AbortController();
      this.requests.set(id, controller);
      this.uppy.emit('upload-start', [file]);
      try {
        const onProgress = (bytesUploaded: number) => {
          if (this.uppy.getFile(id))
            this.uppy.emit('upload-progress', this.uppy.getFile(id), {
              uploadStarted: file.progress.uploadStarted || Date.now(),
              bytesUploaded,
              bytesTotal: file.data.size,
            });
        };
        let body: any;
        let status = 200;
        if (file.data.size <= CHUNKED_UPLOAD_THRESHOLD) {
          const options = this.singleUpload.getOptions(file);
          const response = await fetcher(options.endpoint as string, {
            ...options,
            onBeforeRequest: (xhr, retryCount) =>
              options.onBeforeRequest?.(xhr, retryCount, [file]),
            body: this.singleUpload.createFormDataUpload(file, options),
            signal: controller.signal,
            onUploadProgress: (event) => {
              if (event.lengthComputable)
                onProgress((event.loaded / event.total) * file.data.size);
            },
            onTimeout: () =>
              this.uppy.emit('upload-stalled', new Error('Upload stalled'), [
                file,
              ]),
          });
          body = JSON.parse(response.responseText);
          status = response.status;
        } else {
          body = await uploadMedia(this.opts.fetch, file.data, file.name, {
            linkselfUrl: this.opts.linkselfUrl,
            storageProvider: 'local',
            endpoint: 'upload-server',
            mimeType: file.type,
            signal: controller.signal,
            onProgress,
          });
        }
        if (this.uppy.getFile(id)) {
          this.uppy.emit('upload-success', this.uppy.getFile(id), {
            status,
            body,
          });
        }
      } catch (err) {
        if (this.uppy.getFile(id))
          this.uppy.emit(
            'upload-error',
            this.uppy.getFile(id),
            err instanceof Error ? err : new Error(String(err))
          );
      } finally {
        this.requests.delete(id);
      }
    }
  };

  removed = (file: any) => this.requests.get(file.id)?.abort();
  cancel = () => this.requests.forEach((request) => request.abort());

  install() {
    this.uppy.addUploader(this.upload);
    this.uppy.on('file-removed', this.removed);
    this.uppy.on('cancel-all', this.cancel);
  }

  uninstall() {
    this.cancel();
    this.uppy.removeUploader(this.upload);
    this.uppy.off('file-removed', this.removed);
    this.uppy.off('cancel-all', this.cancel);
  }
}

// Keeps a file in the "processing" state after it reached the bucket until the
// media normalization workflow marks the record ready, the same way
// Transloadit's waitForEncoding holds the dashboard until the assembly is done.
// Files whose record is already ready (no normalizer, gif, ...) pass through.
// The bytes are already stored, so giving up never fails the upload: the
// original file is used instead.
export class WaitForMediaProcessing extends BasePlugin<any, any, any> {
  constructor(
    uppy: any,
    opts: {
      fetch: any;
      processingMessage: string;
      fallbackMessage: string;
      interval?: number;
      maxWait?: number;
    }
  ) {
    super(uppy, opts);
    this.id = 'WaitForMediaProcessing';
    this.type = 'modifier';
  }

  install() {
    this.uppy.addPostProcessor(this.process);
  }

  uninstall() {
    this.uppy.removePostProcessor(this.process);
  }

  process = async (fileIDs: string[]) => {
    await Promise.all(fileIDs.map((id) => this.waitForFile(id)));
  };

  waitForFile = async (id: string) => {
    const file: any = this.uppy.getFile(id);
    const saved = file?.response?.body?.saved;
    if (saved?.status !== 'processing') {
      return;
    }

    this.uppy.emit('postprocess-progress', file, {
      mode: 'indeterminate',
      message: this.opts.processingMessage,
    });

    const interval = this.opts.interval || 2000;
    const deadline = Date.now() + (this.opts.maxWait || 20 * 60 * 1000);
    let failures = 0;
    let media: any = saved;
    // the file disappears when the user cancels, so stop polling with it
    while (this.uppy.getFile(id) && Date.now() < deadline && failures < 5) {
      await sleep(interval);

      try {
        const response = await (
          await this.opts.fetch(`/media/${saved.id}/status`)
        ).json();
        // a 4xx body has no status; treat it like a failed poll
        if (!response?.status) {
          throw new Error(response?.message || 'Media not found');
        }
        media = response;
        failures = 0;
      } catch (err) {
        failures++;
        continue;
      }

      if (media.status !== 'processing') {
        break;
      }
    }

    const current: any = this.uppy.getFile(id);
    if (!current) {
      return;
    }

    if (media.status !== 'ready') {
      // a file that only existed to be converted has nothing to fall back to
      const usable = /\.(png|jpe?g|gif|webp|mp4)$/i.test(media.name || '');
      if (!usable) {
        this.uppy.info(
          media.processingError || this.opts.fallbackMessage,
          'error',
          5000
        );
        this.uppy.setFileState(id, {
          error: media.processingError || 'failed',
        } as any);
        this.uppy.emit('postprocess-complete', this.uppy.getFile(id));
        return;
      }
      this.uppy.info(this.opts.fallbackMessage, 'warning', 5000);
    }

    this.uppy.setFileState(id, {
      response: {
        ...current.response,
        body: { ...current.response.body, saved: media },
      },
    } as any);
    this.uppy.emit('postprocess-complete', this.uppy.getFile(id));
  };
}
const fetchUploadApiEndpoint = async (
  fetch: any,
  endpoint: string,
  data: any
) => {
  const res = await fetch(`/media/${endpoint}`, {
    method: 'POST',
    body: JSON.stringify(data),
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/json',
    },
  });
  // customFetch does not throw on HTTP errors, and Uppy treats whatever this
  // returns as a successful step
  if (!res.ok) {
    throw new Error(await res.text().catch(() => ''));
  }
  return res.json();
};

// Define the factory to return appropriate Uppy configuration
export const getUppyUploadPlugin = (
  provider: string,
  fetch: any,
  backendUrl: string,
  transloadit: string[] = [],
  linkselfUrl = ''
) => {
  switch (provider) {
    case 'transloadit':
      return {
        plugin: Transloadit,
        options: {
          waitForEncoding: true,
          alwaysRunAssembly: true,
          assemblyOptions: {
            params: {
              auth: { key: transloadit[0] },
              template_id: transloadit[1],
            },
          },
        },
      };
    case 'cloudflare':
      return {
        plugin: AwsS3Multipart,
        options: {
          shouldUseMultipart: (file: any) => true,
          endpoint: '',
          createMultipartUpload: async (file: any) => {
            let fileHash = '';
            const contentType = file.type;

            // Skip hash calculation for files larger than 100MB to avoid "Invalid array length" error
            if (file.size <= 100 * 1024 * 1024) {
              try {
                const arrayBuffer = await new Response(file.data).arrayBuffer();
                fileHash = sha256(Buffer.from(arrayBuffer));
              } catch (error) {
                console.warn(
                  'Failed to calculate file hash, proceeding without hash:',
                  error
                );
                fileHash = '';
              }
            }

            return fetchUploadApiEndpoint(fetch, 'create-multipart-upload', {
              file,
              fileHash,
              contentType,
            });
          },
          listParts: (file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'list-parts', {
              file,
              ...props,
            }),
          signPart: (file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'sign-part', {
              file,
              ...props,
            }),
          abortMultipartUpload: (file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'abort-multipart-upload', {
              file,
              ...props,
            }),
          completeMultipartUpload: (file: any, props: any) =>
            fetchUploadApiEndpoint(fetch, 'complete-multipart-upload', {
              file,
              ...props,
            }),
        },
      };
    case 'local':
      if (linkselfUrl) {
        return {
          plugin: LocalChunkedUpload,
          options: { fetch, linkselfUrl, backendUrl },
        };
      }
      return {
        plugin: XHRUpload,
        options: {
          endpoint: `${backendUrl}/media/upload-server`,
          withCredentials: true,
        },
      };

    // Add more cases for other cloud providers
    default:
      throw new Error(`Unsupported storage provider: ${provider}`);
  }
};
