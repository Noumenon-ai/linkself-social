# Moving upload URLs

Run manually from the repository root with the database connection supplied by the environment:

```
pnpm uploads:rewrite-origin --from=https://old.example.com --to=https://linkself.net/dashboard/studio
pnpm uploads:rewrite-origin --from=https://old.example.com --to=https://linkself.net/dashboard/studio --apply
```

The first command reads only. The second changes matching text through Prisma in batches of 200 rows. Both report matched, updated and conflicted row counts per column, without printing URLs, IDs, content or credentials. A concurrent change is counted as a conflict and left untouched; rerun after that edit finishes. Repeating the command is safe. The command has no startup hook and is never invoked by deployments.

Both addresses are an HTTP or HTTPS origin, optionally with a path of plain segments containing letters, digits, dot, underscore, tilde or hyphen, so a move can be undone by swapping them. A `.` or `..` segment is refused. Neither address may contain credentials, queries or fragments. A single trailing slash is removed. The replacement prefix is `<to>/uploads/`. Only the exact `<from>/uploads/` URL prefix is replaced, including occurrences within JSON, HTML and plain text. Other hosts, lookalike hosts, other paths and relative paths remain unchanged. JSON escapes are preserved; the tool does not parse and reserialize content. This handles the literal URL format saved by `JSON.stringify` in this application.

The upload URL inventory follows `LocalStorage.newFilePath`, `uploadSimple`, `uploadFile`, `uploadStream` and `publicUrl`, then their consumers:

- `Media.path`, `Media.thumbnail`: Media repository saves uploads and adjusted media; user and OAuth app pictures and agency logos reference these media records by ID.
- `Integration.picture`: Integration service and repository copy channel avatars into storage.
- `Post.image`: Posts repository serializes attached media, including thumbnails.
- `Post.content`, `Post.settings`: Editor HTML/Markdown and provider settings retain inline uploads, covers and other media fields.
- `Sets.content`: Sets serialize the complete editor payload, including media and settings.
- `Signatures.content`, `AutoPost.content`: Reusable editor content can retain inline media or pasted upload links.
- `Clipping.url`, `Clipping.thumbnail`: Clipping source and source preview URLs.
- `ClippingClip.path`, `ClippingClip.thumbnail`: Rendered clips and previews saved by the clipping service, also copied into Media and draft posts.
- `Comments.content`, `Comments.anchorQuote`: Comments and quoted post text can retain inline upload links.
- `Plugs.data`: Serialized user fields can contain media links used by provider actions.
- `mastra_messages.content`: Chat memory serializes upload tool results and messages containing media URLs.

The inventory covers 17 columns. Credential columns and external provider identifiers are not media storage. Workflow histories and activity files are not modified. This command updates references only; copy the upload files to the new host separately before retiring the old address.

New own-key connections encrypt token copies using the existing channel encryption utility. Their marked token envelope also accepts legacy unmarked tokens on read; reconnecting replaces the old token and custom connection details with encrypted values. This command does not migrate credentials.
