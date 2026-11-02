import localFont from 'next/font/local';

// Self-host the same font assets as the approved Blueprint prototype.
export const archivo = localFont({
  src: [
    { path: './archivo-400.woff2', weight: '400', style: 'normal' },
    { path: './archivo-600.woff2', weight: '600', style: 'normal' },
    { path: './archivo-700.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-blueprint-body',
  display: 'swap',
});
export const spaceMono = localFont({
  src: './space-mono-400.woff2',
  weight: '400',
  variable: '--font-blueprint-mono',
  display: 'swap',
});
export const architectsDaughter = localFont({
  src: './architects-daughter-400.woff2',
  weight: '400',
  variable: '--font-blueprint-note',
  display: 'swap',
});
