// Explicit maintenance command; importing this module never opens a database.
const UPLOAD_COLUMNS = {
  media: ['path', 'thumbnail'],
  integration: ['picture'],
  post: ['image', 'content', 'settings'],
  sets: ['content'],
  signatures: ['content'],
  autoPost: ['content'],
  clipping: ['url', 'thumbnail'],
  clippingClip: ['path', 'thumbnail'],
  comments: ['content', 'anchorQuote'],
  plugs: ['data'],
  mastra_messages: ['content'],
};

function validateOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Both origins must be absolute HTTP or HTTPS origins.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash ||
      ![url.origin, url.origin + '/'].includes(value)) {
    throw new Error('Origins must not contain credentials, paths, queries or fragments.');
  }
  return url.origin;
}

function parseArguments(args) {
  const values = {};
  for (const arg of args) {
    const match = /^(--from|--to)=(.+)$/.exec(arg);
    const key = match ? match[1].slice(2) : arg === '--apply' ? 'apply' : '';
    if (!key || Object.hasOwn(values, key)) throw new Error('Use --from=<origin> --to=<origin> [--apply].');
    values[key] = match ? match[2] : true;
  }
  return { from: validateOrigin(values.from), to: validateOrigin(values.to), apply: values.apply === true };
}

function replaceUploadOrigin(text, from, to) {
  if (typeof text !== 'string') return text;
  const prefix = validateOrigin(from) + '/uploads/';
  const replacement = validateOrigin(to) + '/uploads/';
  // A boundary avoids rewriting a URL embedded in another host or URL path.
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp('(^|[\\s"\'`(=<>\\[])' + escaped, 'g'), (_, boundary) => boundary + replacement);
}

async function migrateUploadOrigin(prisma, { from, to, apply = false }, log = console.log) {
  from = validateOrigin(from);
  to = validateOrigin(to);
  const counts = {};
  for (const [model, columns] of Object.entries(UPLOAD_COLUMNS)) {
    for (const column of columns) {
      const key = `${model}.${column}`;
      counts[key] = { matched: 0, updated: 0, conflicted: 0 };
      let cursor;
      while (true) {
        const rows = await prisma[model].findMany({
          where: { [column]: { contains: from + '/uploads/' }, ...(cursor ? { id: { gt: cursor } } : {}) },
          select: { id: true, [column]: true },
          orderBy: { id: 'asc' },
          take: 200,
        });
        if (!rows.length) break;
        for (const row of rows) {
          const value = replaceUploadOrigin(row[column], from, to);
          if (value === row[column]) continue;
          counts[key].matched++;
          if (apply) {
            // Compare the old text so a concurrent edit is never overwritten.
            const result = await prisma[model].updateMany({
              where: { id: row.id, [column]: row[column] },
              data: { [column]: value },
            });
            counts[key].updated += result.count;
            counts[key].conflicted += result.count === 0 ? 1 : 0;
          }
        }
        cursor = rows[rows.length - 1].id;
      }
      const count = counts[key];
      log(`${key}: matched=${count.matched} updated=${count.updated} conflicted=${count.conflicted}`);
    }
  }
  return counts;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient({ log: [] });
  try { await migrateUploadOrigin(prisma, options); }
  finally { await prisma.$disconnect(); }
}

if (require.main === module) {
  main().catch(() => {
    // Prisma errors can include query values; never print them.
    console.error('Upload URL migration failed. Check arguments and database access.');
    process.exitCode = 1;
  });
}
module.exports = { UPLOAD_COLUMNS, validateOrigin, parseArguments, replaceUploadOrigin, migrateUploadOrigin };
