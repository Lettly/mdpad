# Collapsible sections

A `<details>` block renders as a disclosure on GitHub. In mdpad it is one block: the summary and
the content are both Markdown, and the section collapses as it does on GitHub. Hover it and press
**Edit** — or double-click the summary or the content — to edit both parts in place. `⌘/Ctrl+Enter`
saves, `Esc` cancels, and clicking elsewhere saves the draft.

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

## Nested sections

<details>
<summary>A section inside a section</summary>

<details>
<summary>The **inner** section</summary>

Nested sections render inside their parent, and the inner summary is Markdown too.

</details>

The outer content continues after the inner section.

</details>

## Raw HTML in the content

<details>
<summary>A centred line and a key</summary>

<div align="center">A centred line with <kbd>⌘</kbd> in it.</div>

</details>

## Closed by default, one open

<details>
<summary>First section</summary>

The first body.

</details>

<details open>
<summary>Second section (open)</summary>

The `open` attribute keeps a section expanded when the page loads. mdpad renders the same state:
click the summary to open it while editing, and **Open by default** in the editor writes the
attribute.

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
