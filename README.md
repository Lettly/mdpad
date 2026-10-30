# mdpad

A small WYSIWYG Markdown editor for GitHub repositories. Paste a repo or file URL, browse the
tree, edit in rich text (or raw Markdown), and save — which commits straight to the branch.

Everything runs in the browser: no server, no backend, no database. The page talks directly to
`api.github.com` with a personal access token that never leaves `localStorage`.

## Using it

1. Open the app.
2. Paste a fine-grained personal access token with **Contents: read and write** on the
   repositories you want to edit. Create one at
   <https://github.com/settings/personal-access-tokens/new>.
3. Paste a repository or file URL:
   - `https://github.com/owner/repo`
   - `https://github.com/owner/repo/blob/main/docs/guide.md`
   - `https://raw.githubusercontent.com/owner/repo/main/README.md`
   - or just `owner/repo`

Deep links work too, so a URL like `#/owner/repo/blob/main/README.md` opens that file directly.

`⌘S` / `Ctrl+S` opens the commit dialog. Saves are plain commits to the selected branch — no pull
request, no review. If the file changed on GitHub in the meantime, GitHub rejects the write and
you get a conflict error; reload and re-apply.

## Development

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
```

## Deployment

Pushes to `main` build the site and publish it to GitHub Pages through
`.github/workflows/deploy.yml`. The Vite `base` is `/mdpad/`, so the app lives at
`https://<user>.github.io/mdpad/`. Rename the repository and update `base` in `vite.config.ts` if
you want a different path.

Note that a Pages site is public even when its repository is private: anyone with the URL can load
the app. There is nothing secret in it — each visitor brings their own token.

## How it works

| Piece | What it does |
| --- | --- |
| `src/lib/github.ts` | REST client for the contents, trees and branches endpoints |
| `src/lib/githubUrl.ts` | Turns pasted repository/file URLs into `owner`, `repo`, `branch`, `path` |
| `src/lib/route.ts` | Hash router, so deep links work on a static host |
| `src/lib/tree.ts` | Flat git tree → collapsible file tree |
| `src/components/MarkdownEditor.tsx` | Toast UI Editor, WYSIWYG with a raw Markdown mode |

Saving reads the file's blob `sha` when it is opened and sends it back with the write, which is how
GitHub detects that you edited a stale copy.

Markdown from the repository is sanitised with DOMPurify before it renders, so a hostile file cannot
script a page that holds your token.

## Limits

- Only `.md`, `.markdown`, `.mdx` and `.txt` files are editable; the rest are listed but dimmed.
- Writes go through the contents API, which caps out at 1 MB per file.
- Rich text round-trips through Toast UI's Markdown serialiser, so exotic Markdown (raw HTML blocks,
  deeply nested tables) can be normalised on the first save. The raw Markdown mode is exact.
