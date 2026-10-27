import { writeFileSync, readFileSync } from 'fs';
import { resolve } from 'path';
import sharp from 'sharp';
import { APP_NAME } from '../libraries/helpers/src/app-name';

async function generate() {
  const publicDir = resolve(__dirname, '../apps/frontend/public');
  const monogram = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="LinkSelf Social">
  <rect width="128" height="128" rx="20" fill="#0B0B0C"/>
  <path d="M27 32h12v52h23v12H27z" fill="#F2EDE4"/>
  <path d="M101 38c-6-5-12-7-20-7-12 0-20 7-20 18 0 10 6 15 18 19 9 3 12 5 12 10 0 5-4 8-11 8-7 0-14-3-20-8v14c6 4 13 6 21 6 14 0 23-8 23-21 0-11-7-16-19-20-8-3-11-5-11-9 0-4 3-6 8-6 7 0 13 3 19 8z" fill="#C9A24A"/>
</svg>\n`;
  const wordmark = `<svg xmlns="http://www.w3.org/2000/svg" width="404" height="66" viewBox="0 0 404 66" role="img" aria-label="LinkSelf Social">
  <rect width="404" height="66" rx="8" fill="#0B0B0C"/>
  <text x="16" y="45" font-family="Arial, sans-serif" font-size="38" font-weight="600" fill="#F2EDE4">LinkSelf <tspan fill="#C9A24A">Social</tspan></text>
</svg>\n`;
  for (const file of ['logo.svg', 'postiz.svg'])
    writeFileSync(resolve(publicDir, file), monogram);
  for (const file of ['logo-text.svg', 'postiz-text.svg'])
    writeFileSync(resolve(publicDir, file), wordmark);
  for (const file of ['postiz-fav.png', 'favicon.png']) {
    await sharp(Buffer.from(monogram))
      .resize(256, 256)
      .png()
      .toFile(resolve(publicDir, file));
  }
  // ICO supports PNG image payloads. Include three sizes for browser/OS consumers.
  const sizes = [16, 32, 48];
  const images = await Promise.all(
    sizes.map((size) =>
      sharp(Buffer.from(monogram)).resize(size, size).png().toBuffer()
    )
  );
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  images.forEach((image: Buffer, i: number) => {
    const entry = 6 + 16 * i;
    header[entry] = sizes[i];
    header[entry + 1] = sizes[i];
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(image.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += image.length;
  });
  writeFileSync(
    resolve(publicDir, 'favicon.ico'),
    Buffer.concat([header, ...images])
  );
  for (const size of [32, 128]) {
    await sharp(Buffer.from(monogram))
      .resize(size, size)
      .png()
      .toFile(resolve(__dirname, `../apps/extension/public/icon-${size}.png`));
  }
  for (const file of ['manifest.json', 'manifest.dev.json']) {
    const location = resolve(__dirname, '../apps/extension', file);
    const manifest = JSON.parse(readFileSync(location, 'utf8'));
    manifest.name = APP_NAME;
    manifest.description = `${APP_NAME} browser extension for social media scheduling`;
    writeFileSync(location, JSON.stringify(manifest, null, 2) + '\n');
  }
}
generate().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
