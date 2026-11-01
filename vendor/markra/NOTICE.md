# Vendored Markra packages

This directory is source copied from the Markra editor, which mdpad uses as its
Markdown editor.

- Upstream: <https://github.com/markrahq/markra>
- Website: <https://editor.markra.app>
- Commit: `8fc7b4a3743ecb11d1e1b43609dd0e80192f4548` (v2.14.3)
- License: AGPL-3.0-only — see `LICENSE` in this directory and the repository's
  `LICENSE`.

## What is here

| Directory | Upstream path |
| --- | --- |
| `packages/editor` | `packages/editor` |
| `packages/editor-react` | `packages/editor-react` |
| `packages/markdown` | `packages/markdown` |
| `packages/shared` | `packages/shared` |
| `stubs/ai.ts` | type-only stand-in for `packages/ai` |
| `stubs/tauri-core.ts` | stand-in for `@tauri-apps/api/core` |

Test files and the upstream `tsconfig*.json` files are not copied. The packages
are consumed as source: `vite.config.ts` and `tsconfig.app.json` alias the
`@markra/*` specifiers at this tree.

Markra's app-side editor chrome is vendored separately, in `src/markra/`:

| Path | Upstream path |
| --- | --- |
| `src/markra/paper.css` | `packages/app/src/styles.css` |
| `src/markra/chrome/` | `packages/app/src/components/` (`CodeMirror*`, `SpellcheckSuggestionMenu`) |
| `src/markra/lib/` | `packages/app/src/lib/` (`document-links`, `markdown-link-target`, `spellcheck-menu`, `plain-text-paste`, `vim-labels`) |

`src/markra/lib/settings.ts` and `src/markra/lib/runtime.ts` are mdpad's own
stand-ins for the app settings types and the desktop runtime the chrome reads.

## Attribution

Upstream carries no per-file copyright headers: each package declares
`"license": "AGPL-3.0-only"` in its `package.json`, and the licence text is in
`LICENSE`. Those are copied verbatim, so attribution travels with the files;
adding headers of our own would only make the next sync a merge.

## Local modifications

Keep this list short and exact — everything else is upstream verbatim, so a
future sync stays a straight copy.

1. `src/markra/paper.css` — the upstream stylesheet with two changes: the
   `@layer base` theme block is scoped to `.markra-root` (so it themes the
   editor subtree instead of the whole page), and the `html`/`body`/`#root`
   rules and the Tauri scrollbar workaround are dropped. Tailwind's preflight
   is not imported; only its theme and utility layers are, so mdpad's own
   styles are untouched.
2. `src/markra/chrome/CodeMirrorPaperSurface.tsx` — added a `rawHtmlSkip` prop,
   passed through to `rawHtmlPreviewPlugin`, for the same reason as the editor
   package patch below.
3. `packages/editor/src/codemirror/raw-html-preview.ts` — two changes:
   - an optional `skip?: (source: string) => boolean` on
     `RawHtmlPreviewPluginOptions`, with a single
     `if (options.skip?.(range.source)) continue;` guard in
     `buildRawHtmlDecorations`. mdpad renders collapsible sections itself (see
     `src/editor/markra/details.ts`), and two plugins cannot replace the same
     range.
   - void inline tags (`<img>`, `<br>`) become their own rendered range instead
     of being skipped, and a range nested inside another is dropped so
     replacements never overlap. Without this a `<img width="…">` — the usual
     way to size a logo — showed as source text.
4. `packages/editor/src/codemirror/image.ts` and `links.ts` — reference-style
   images (`![alt][label]`, `![alt][]`, `![alt]`) resolve their source from the
   document's link reference definitions instead of falling back to source
   text, which is what badge markup (`[![build][badge]][ci]`) is written as.
   `links.ts` exports `normalizeMarkdownLinkLabel` for that lookup; nothing else
   in it changed.
5. `packages/editor/src/codemirror/preview.ts` — a `LinkReference` definition
   (`[label]: url`) is hidden, like every other Markdown mark, until the caret
   enters its line. GitHub renders nothing for a definition, so leaving it in
   the flow showed a stray `[label]` and its URL as prose. The rule that hides
   the line lives in `src/styles.css`.

## Why these two stubs

- `@markra/ai`: the editor imports five types from it and nothing at runtime.
  mdpad does not ship Markra's AI features, so only those type shapes are
  copied.
- `@tauri-apps/api/core`: `@markra/markdown` uses `convertFileSrc` to point
  images at local files in the desktop app. mdpad is a browser app and never
  takes that path; the stub throws if it is ever called.
