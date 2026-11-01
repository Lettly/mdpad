---
title: Front matter
description: A document with YAML metadata at the top
tags:
  - markdown
  - front-matter
draft: false
---

# Front matter

A YAML block between two `---` lines at the very top of the file is front matter. Static site
generators use it for titles, layouts, dates and taxonomies; GitHub renders it as a table above the
document.

## The block above

```yaml
---
title: Front matter
description: A document with YAML metadata at the top
tags:
  - markdown
  - front-matter
draft: false
---
```

## Content after the block

Everything below the closing `---` is ordinary Markdown:

- a list
- with **formatting**
- and a [link](https://github.com)

> A quote, to show that the document body is unaffected.

| Key | Value |
| --- | --- |
| `draft` | `false` |
| `tags` | two |

## Notes

- The opening `---` must be the first line of the file.
- The block is YAML, so indentation matters.
- A document without front matter starts with its first heading, as usual.
