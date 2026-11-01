# Tables

## Basic

| Language | Created | Use |
| --- | --- | --- |
| TypeScript | 2012 | Web and tooling |
| Rust | 2010 | Systems |
| Go | 2009 | Services |

## Alignment

| Left | Centre | Right |
| :--- | :----: | ----: |
| left | centre | right |
| `code` | **bold** | *italic* |
| a longer cell | a much longer cell | 1,234.56 |

## Inline content in cells

| Kind | Example | Notes |
| --- | --- | --- |
| Link | [Markra](https://github.com/markrahq/markra) | opens in a new tab |
| Code | `npm run build` | monospace |
| Escaped pipe | a \| b | the pipe is literal |
| Empty cells |  |  |

## Wide table

| Column one | Column two | Column three | Column four | Column five | Column six |
| --- | --- | --- | --- | --- | --- |
| 1 | 2 | 3 | 4 | 5 | 6 |
| alpha | beta | gamma | delta | epsilon | zeta |
| a | b | c | d | e | f |

## A table between paragraphs

The paragraph above the table belongs to the same section.

| Step | What happens |
| --- | --- |
| 1 | You type a pipe |
| 2 | The preview becomes a grid |
| 3 | Click a cell to edit it |

The paragraph below continues after the table.

## Table with long cells

| Question | Answer |
| --- | --- |
| Why does a cell wrap? | Because the column is narrow enough that the text needs more than one line, and the preview wraps it rather than scrolling sideways. |
| Can a cell hold a list? | Not in GFM tables — a cell is a single line of Markdown. |
