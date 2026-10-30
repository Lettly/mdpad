# Example document

A tour of what mdpad shows, in rich text or in raw Markdown. Open this file in
[mdpad](https://lettly.github.io/mdpad/#/Lettly/mdpad/blob/main/examples/example.md) and edit it —
saving commits straight to `main`.

## Text

Regular text with **bold**, *italic*, ~~strikethrough~~, `inline code`, and a
[link](https://github.com). Unicode survives too: — … “quotes” and it’s.

## Lists

- First item
- Second item
  - Nested item
  - Another nested item
- Third item

1. Numbered
2. In order
3. And so on

- [x] Shipped
- [ ] Planned

## Table

| Feature | Rich text | Markdown |
| --- | --- | --- |
| Tables | yes | yes |
| Task lists | yes | yes |
| Raw HTML | no | yes |

## Code

```ts
const editor = new Editor({ el, height: '100%' })
editor.setMarkdown(source, false)
```

> A blockquote, for when a sentence needs a step back.

## Notes

- Saves are plain commits: no pull request, no review.
- If the file changed on GitHub since you opened it, the write is rejected.
- Files with raw HTML or footnotes open in Markdown mode, because rich text would
  drop them.
