import localFont from 'next/font/local';

export const figtree = localFont({
  src: [
    { path: './figtree-latin-ext-wght-normal.woff2', weight: '400 700', style: 'normal' },
    { path: './figtree-latin-wght-normal.woff2', weight: '400 700', style: 'normal' },
  ],
  variable: '--font-figtree',
  display: 'swap',
});
