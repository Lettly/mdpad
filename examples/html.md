# Raw HTML

Markdown carries HTML for the things it has no syntax for. Raw HTML renders as content; click a
block to reveal the source in place.

## Block level

<div align="center">

### A centred heading

A centred paragraph, written as a `div` with `align="center"`.

</div>

<div style="border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px;">

A card made of a `div`. GitHub strips inline styles in some contexts, so a document that needs to
survive GitHub rendering is better off with plain elements.

</div>

## Inline level

Press <kbd>⌘</kbd> + <kbd>S</kbd> to save. Water is H<sub>2</sub>O and the area is 3 cm<sup>2</sup>.
A phrase can be <mark>marked</mark>, <u>underlined</u>, <s>struck out</s>, or wrapped in
<abbr title="Application Programming Interface">API</abbr>.

A line break without a blank line: first line<br />second line.

## A table written as HTML

<table>
  <thead>
    <tr><th>Kind</th><th>Element</th></tr>
  </thead>
  <tbody>
    <tr><td>Row</td><td><code>tr</code></td></tr>
    <tr><td>Cell</td><td><code>td</code></td></tr>
  </tbody>
</table>

## Images

<img src="https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png" alt="The GitHub mark" width="64" height="64" />

An `<img>` with explicit dimensions, next to an image written as Markdown:
![The GitHub mark](https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png)

## Comments

<!-- This comment is invisible in the rendered page but stays in the source. -->

A comment sits above this paragraph and renders nothing.

## HTML inside other blocks

> A quote can hold <kbd>keys</kbd> and <mark>marks</mark>.

- A list item can hold <sub>subscript</sub> too.

## Mixed with Markdown

<div>

Markdown inside a `div` block still renders when there is a blank line after the tag.

- lists work
- so do **emphasis** and [links](https://github.com)

</div>
