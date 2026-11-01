# Collapsible sections

A `<details>` block renders as a disclosure on GitHub. In mdpad it is one block: the summary and
the content are both Markdown, and **Edit section** on the block opens a form for the two parts.

## Simple

<details>
<summary>Click to read more</summary>

The content is hidden until someone opens the box. Everything inside is ordinary Markdown.

</details>

## Summary with formatting

<details>
<summary>**Bold** summary with `code`</summary>

The summary is Markdown, so emphasis and inline code work there too.

</details>

## Rich content

<details>
<summary>What can the content hold?</summary>

Almost any block:

- lists, with [links](https://github.com)
- a table:

  | Feature | Supported |
  | --- | --- |
  | Paragraphs | yes |
  | Lists | yes |
  | Code | yes |

- and a fenced block:

  ```ts
  const hidden = 'until opened'
  ```

</details>

## Closed by default, one open

<details>
<summary>First section</summary>

The first body.

</details>

<details open>
<summary>Second section (open)</summary>

The `open` attribute keeps a section expanded when the page loads. The preview shows every section
expanded while you edit it.

</details>

## Several in a row

<details>
<summary>Installation</summary>

```bash
npm install
```

</details>

<details>
<summary>Configuration</summary>

Edit `.env` and set the two public values.

</details>

<details>
<summary>Deployment</summary>

Push to `main`; the workflow builds and publishes.

</details>

## Text around the block

A paragraph before a section stays outside it.

<details>
<summary>A section between paragraphs</summary>

Its content belongs to the section, not to the surrounding text.

</details>

A paragraph after the section continues the document.
