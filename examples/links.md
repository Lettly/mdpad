# Links

## Inline

A [link](https://github.com) with no title, and a [link with a title](https://github.com 'GitHub')
that shows the title on hover.

## Reference

Reference links keep long URLs out of the prose. This sentence points at [the Markra
repository][markra] and at [the editor][editor].

[markra]: https://github.com/markrahq/markra
[editor]: https://editor.markra.app 'Markra in the browser'

## Collapsed and shortcut references

A [markra][] reference and a [markra] shortcut both resolve to the same definition above.

## Autolinks

<https://github.com/markrahq/markra>

<hello@example.com>

A bare URL also becomes a link: https://editor.markra.app

## Relative and anchor links

- [Up to the top](#links)
- [Another document in this folder](./text.md)
- [A folder](../examples)
- [A file with a space](./text.md#headings)

## Link with formatting inside

A link whose label is [**bold** and `code`](https://github.com) keeps its formatting.

## Links inside blocks

> A quote with a [link](https://github.com).

- A list item with a [link](https://github.com).

| Kind | Example |
| --- | --- |
| In a cell | [GitHub](https://github.com) |

## Images as links

[![The GitHub mark](https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png)](https://github.com)

## What is not a link

Not a link: \[not a link\](https://github.com), and `https://example.com` inside inline code stays
literal.

An unsafe scheme is refused by the preview: [click me](javascript:alert('nope')).
