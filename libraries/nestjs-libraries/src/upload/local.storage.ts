import { frontendUrl } from '@gitroom/helpers/utils/base-path';
import { IUploadProvider, UploadedStream } from './upload.interface';
import {
  createReadStream,
  createWriteStream,
  mkdirSync,
  unlink,
  writeFileSync,
} from 'fs';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'fs/promises';
import { randomBytes } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import {
  StartChunkedUploadDto,
  CompleteChunkedUploadDto,
} from '../dtos/media/chunked.upload.dto';
import {
  getMaxSize,
  maxSizeStream,
  UPLOAD_ALLOWED_MIME,
  uploadOriginalName,
  uploadStreamToStorage,
} from './custom.upload.validation';
import { resolve, sep } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { isSafePublicHttpsUrl } from '@gitroom/nestjs-libraries/dtos/webhooks/webhook.url.validator';
import { ssrfSafeDispatcher } from '@gitroom/nestjs-libraries/dtos/webhooks/ssrf.safe.dispatcher';
import { parseDataUrl } from '@gitroom/nestjs-libraries/upload/data.url';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { fileTypeFromBuffer } = require('file-type');

const LOCAL_STORAGE_ALLOWED_MIME = new Set<string>([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  'image/tiff',
  'video/mp4',
  'audio/mpeg',
  'audio/mp4',
  'audio/wav',
  'audio/ogg',
]);
export class LocalStorage implements IUploadProvider {
  constructor(private uploadDirectory: string) {}

  private chunkedDirectory() {
    return resolve(this.uploadDirectory, '.chunked');
  }

  async startChunkedUpload(org: string, data: StartChunkedUploadDto) {
    if (
      typeof data.name !== 'string' ||
      !data.name ||
      !UPLOAD_ALLOWED_MIME.has(data.mimeType) ||
      !Number.isSafeInteger(data.size) ||
      data.size < 1 ||
      data.size > getMaxSize(data.mimeType)
    ) {
      throw new BadRequestException('Invalid upload details');
    }

    const root = this.chunkedDirectory();
    await mkdir(root, { recursive: true, mode: 0o700 });
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      const folder = resolve(root, entry.name);
      const created = await stat(resolve(folder, 'metadata.json'))
        .catch(() => stat(folder))
        .catch(() => null);
      if (created && created.mtimeMs < Date.now() - 24 * 60 * 60 * 1000) {
        await rm(folder, { recursive: true, force: true });
      }
    }

    const uploadId = randomBytes(32).toString('hex');
    const folder = resolve(root, uploadId);
    await mkdir(folder, { mode: 0o700 });
    try {
      await writeFile(
        resolve(folder, 'metadata.json'),
        JSON.stringify({
          org,
          name: data.name,
          size: data.size,
          mimeType: data.mimeType,
          createdAt: Date.now(),
        }),
        { mode: 0o600, flag: 'wx' }
      );
      return { uploadId };
    } catch (err) {
      await rm(folder, { recursive: true, force: true });
      throw err;
    }
  }

  private async withChunkedUpload<T>(
    org: string,
    uploadId: string,
    complete: boolean,
    action: (folder: string, data: StartChunkedUploadDto) => Promise<T>
  ) {
    if (!/^[a-f0-9]{64}$/.test(uploadId)) {
      throw new BadRequestException('Invalid upload id');
    }
    const folder = resolve(this.chunkedDirectory(), uploadId);
    const data = await readFile(resolve(folder, 'metadata.json'), 'utf8')
      .then((value) => JSON.parse(value))
      .catch(() => null);
    if (!data || data.org !== org) {
      throw new BadRequestException('Upload not found');
    }
    // Serializes part writes and completion, including across backend processes.
    const lock = resolve(folder, 'lock');
    await mkdir(lock).catch(() => {
      throw new BadRequestException('Upload is busy');
    });
    let remove = complete;
    try {
      if (data.createdAt < Date.now() - 24 * 60 * 60 * 1000) {
        throw new BadRequestException('Upload expired');
      }
      return await action(folder, data);
    } catch (err) {
      remove = true;
      throw err;
    } finally {
      await rm(remove ? folder : lock, { recursive: true, force: true });
    }
  }

  async uploadChunk(
    org: string,
    uploadId: string,
    index: string,
    body: Readable
  ) {
    await this.withChunkedUpload(org, uploadId, false, async (folder, data) => {
      if (!/^(0|[1-9][0-9]{0,2})$/.test(index) || Number(index) >= 256) {
        throw new BadRequestException('Invalid part index');
      }
      const target = resolve(folder, `${index}.part`);
      await pipeline(
        body,
        maxSizeStream(4 * 1024 * 1024),
        createWriteStream(target, {
          flags: 'wx',
          mode: 0o600,
        })
      );
      let total = 0;
      for (const name of await readdir(folder)) {
        if (name.endsWith('.part'))
          total += (await stat(resolve(folder, name))).size;
      }
      if (!(await stat(target)).size || total > data.size) {
        throw new BadRequestException('Invalid upload size');
      }
    });
  }

  async abortChunkedUpload(org: string, uploadId: string) {
    await this.withChunkedUpload(org, uploadId, true, async () => {});
  }

  async completeChunkedUpload(
    org: string,
    uploadId: string,
    body: CompleteChunkedUploadDto
  ) {
    return this.withChunkedUpload(org, uploadId, true, async (folder, data) => {
      if (
        !Number.isInteger(body.partCount) ||
        body.partCount < 1 ||
        body.partCount > 256 ||
        (body.preventSave !== undefined &&
          typeof body.preventSave !== 'boolean')
      ) {
        throw new BadRequestException('Invalid completion details');
      }
      const parts = (await readdir(folder)).filter((name) =>
        name.endsWith('.part')
      );
      const ordered = Array.from(
        { length: body.partCount },
        (_, index) => `${index}.part`
      );
      if (
        parts.length !== ordered.length ||
        ordered.some((name) => !parts.includes(name))
      ) {
        throw new BadRequestException('Invalid upload parts');
      }
      let size = 0;
      for (const name of ordered)
        size += (await stat(resolve(folder, name))).size;
      if (size !== data.size)
        throw new BadRequestException('Invalid upload size');

      const stream = Readable.from(
        (async function* () {
          for (const name of ordered) {
            yield* createReadStream(resolve(folder, name));
          }
        })()
      );
      try {
        const uploaded = await uploadStreamToStorage(
          this,
          Readable.toWeb(stream) as any,
          size
        );
        return {
          ...uploaded,
          originalname: uploadOriginalName(data.name, uploaded.ext),
        };
      } finally {
        stream.destroy();
      }
    });
  }

  // Files live under /YYYY/MM/DD with a random name; creates the folder
  private newFilePath(ext: string) {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');

    const innerPath = `/${year}/${month}/${day}`;
    const dir = `${this.uploadDirectory}${innerPath}`;
    mkdirSync(dir, { recursive: true });

    const randomName = Array(32)
      .fill(null)
      .map(() => Math.round(Math.random() * 16).toString(16))
      .join('');

    const filename = `${randomName}.${ext}`;
    return {
      filename,
      filePath: `${dir}/${filename}`,
      path: frontendUrl() + '/uploads' + `${innerPath}/${filename}`,
    };
  }

  async uploadSimple(path: string) {
    const dataUrl = path.startsWith('data:') ? parseDataUrl(path) : null;

    let body: Buffer;
    if (dataUrl) {
      body = dataUrl.buffer;
    } else {
      if (!(await isSafePublicHttpsUrl(path))) {
        throw new Error('Unsafe URL');
      }
      const loadImage = await fetch(path, {
        // @ts-ignore — undici option, not in lib.dom fetch types
        dispatcher: ssrfSafeDispatcher,
      });
      body = Buffer.from(await loadImage.arrayBuffer());
    }

    // Never trust the claimed mime/extension (data URL header, remote
    // content-type, or URL path): sniff the real type from the bytes and
    // only accept the allow-list, otherwise an attacker could write an
    // arbitrary file (e.g. .html/.svg with embedded script) into the
    // publicly served uploads directory on the app's own origin.
    const detected = await fileTypeFromBuffer(body);
    if (!detected || !LOCAL_STORAGE_ALLOWED_MIME.has(detected.mime)) {
      throw new Error('Unsupported file type.');
    }

    const { filePath, path: publicUrl } = this.newFilePath(detected.ext);
    // Logic to save the file to the filesystem goes here
    writeFileSync(filePath, body);

    return publicUrl;
  }

  async uploadFile(file: Express.Multer.File): Promise<any> {
    try {
      const detected = await fileTypeFromBuffer(file.buffer);
      if (!detected || !LOCAL_STORAGE_ALLOWED_MIME.has(detected.mime)) {
        throw new Error('Unsupported file type.');
      }
      const safeMime = detected.mime;

      const { filename, filePath, path } = this.newFilePath(detected.ext);
      writeFileSync(filePath, file.buffer);

      return {
        filename,
        path,
        mimetype: safeMime,
        originalname: filename,
      };
    } catch (err) {
      console.error('Error uploading file to Local Storage:', err);
      throw err;
    }
  }

  async uploadStream(
    stream: Readable,
    mimetype: string,
    ext: string
  ): Promise<UploadedStream> {
    try {
      if (!LOCAL_STORAGE_ALLOWED_MIME.has(mimetype)) {
        throw new Error('Unsupported file type.');
      }

      const { filename, filePath, path } = this.newFilePath(ext);
      try {
        await pipeline(stream, createWriteStream(filePath));
      } catch (err) {
        // Don't leave a truncated file behind (size cap hit, remote closed, ...)
        await this.removeFile(filePath).catch(() => {});
        throw err;
      }

      return {
        filename,
        path,
        mimetype,
        originalname: filename,
      };
    } catch (err) {
      console.error('Error streaming file to Local Storage:', err);
      throw err;
    }
  }

  // Accepts either the public URL or the filesystem path. Callers can pass a
  // stored media name or path, so only a file inside the upload directory is
  // ever deleted: resolve() collapses any `..` segments before the comparison
  async removeFile(filePath: string): Promise<void> {
    const publicPrefix = frontendUrl() + '/uploads';
    const base = resolve(String(this.uploadDirectory));
    const localPath = resolve(
      filePath.startsWith(publicPrefix)
        ? this.uploadDirectory + filePath.slice(publicPrefix.length)
        : filePath
    );
    if (!localPath.startsWith(base + sep)) {
      throw new Error('Unsafe file path');
    }
    // Logic to remove the file from the filesystem goes here
    return new Promise((resolve, reject) => {
      unlink(localPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}
