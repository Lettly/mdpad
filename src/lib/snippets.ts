/**
 * Blocks that the rich-text editor cannot produce, because Toast UI has no node
 * for them. Each one is plain Markdown/HTML text, so it is inserted into the
 * Markdown source rather than into the ProseMirror document.
 */

export type Snippet = {
  id: string
  label: string
  /** Short label for the toolbar chip. */
  short: string
  hint: string
  /** Block snippets get blank lines around them so they stay separate. */
  block: boolean
  text: string
}

export const SNIPPETS: Snippet[] = [
  {
    id: 'details',
    short: 'Details',
    label: 'Collapsible section',
    hint: '<details>',
    block: true,
    text: [
      '<details>',
      '<summary>Summary</summary>',
      '',
      'Hidden until someone opens it.',
      '',
      '</details>',
    ].join('\n'),
  },
  {
    id: 'footnote',
    short: 'Footnote',
    label: 'Footnote',
    hint: '[^1]',
    block: true,
    text: ['A claim that needs a source.[^1]', '', '[^1]: The source.'].join('\n'),
  },
  {
    id: 'alert',
    short: 'Callout',
    label: 'Alert',
    hint: '> [!NOTE]',
    block: true,
    text: ['> [!NOTE]', '> Something worth pointing out.'].join('\n'),
  },
  {
    id: 'math',
    short: 'Math',
    label: 'Math block',
    hint: '$$',
    block: true,
    text: ['$$', 'E = mc^2', '$$'].join('\n'),
  },
  {
    id: 'kbd',
    short: 'Key',
    label: 'Keyboard key',
    hint: '<kbd>',
    block: false,
    text: '<kbd>⌘</kbd> + <kbd>S</kbd>',
  },
]

export function snippetFor(id: string): Snippet | undefined {
  return SNIPPETS.find((snippet) => snippet.id === id)
}

/** Surrounds block snippets with blank lines, so they never glue onto prose. */
export function snippetPayload(snippet: Snippet): string {
  return snippet.block ? `\n\n${snippet.text}\n\n` : snippet.text
}
