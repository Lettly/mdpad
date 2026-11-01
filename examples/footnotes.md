# Footnotes

A footnote reference looks like this[^1] and GitHub numbers them in order of appearance. A second
reference[^note] gets the next number, and the definitions are collected at the bottom of the page.

## Inline placement

Footnotes can follow any inline run: after **bold text**[^bold], after `inline code`[^code], and
after a [link](https://github.com)[^link].

## Multi-paragraph definitions

A definition can hold more than one paragraph.[^long]

## Code in a footnote

A definition can carry a fenced block too.[^fenced]

## Reference by name

Named references read better in the source than numbers.[^naming] The name never appears in the
rendered page — only the number does.

## Unused definition

This definition is declared but never referenced, so it renders as a definition without a number.

[^unused]: Nobody points at this one.

[^1]: The first footnote, kept to one line.

[^note]: A named footnote. Names are case-insensitive and may contain dashes.

[^bold]: A footnote attached to bold text.

[^code]: A footnote attached to inline code.

[^link]: A footnote attached to a link.

[^long]: The first paragraph of a long definition.

    The second paragraph is indented by four spaces, which keeps it inside the definition.

    A third paragraph behaves the same way.

[^fenced]: A definition with code:

    ```ts
    const inFootnote = true
    ```

[^naming]: Names make the source easier to read, especially when a document has many footnotes.
