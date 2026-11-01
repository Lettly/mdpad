# Lists

## Bullet lists

- A plain item
- An item with **bold** and `code`
- An item with a [link](https://github.com)
- An item that wraps onto a second line because it is long enough to need one, which
  Markdown treats as the same item
- An item whose child list starts on the next line
  - Nested one level
  - Another at the same level
    - Nested two levels
    - Still two levels
  - Back to one level
- Back to the top level

## Ordered lists

1. First
2. Second
3. Third

A list can start at any number:

7. Seven
8. Eight
9. Nine

And it can nest:

1. First
   1. First child
   2. Second child
2. Second
   1. Another child
      1. Grandchild
3. Third

## Task lists

- [x] Write the editor
- [x] Vendor the packages
- [ ] Write the documentation
- [ ] Ship it
  - [x] A completed sub-task
  - [ ] An open sub-task

## Mixed content in items

- An item with a paragraph

  and a second paragraph inside the same item.

- An item with a quote:

  > A blockquote inside a list item.

- An item with code:

  ```ts
  const inside = 'a list'
  ```

- An item with a table:

  | Key | Value |
  | --- | --- |
  | a | 1 |
  | b | 2 |

## Loose and tight

A tight list has no blank lines between items:

- one
- two
- three

A loose list does, and its items get paragraph spacing:

- one

- two

- three
