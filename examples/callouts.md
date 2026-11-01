# Callouts

GitHub renders a blockquote that starts with a marker as a coloured box. There are five kinds.

## Note

> [!NOTE]
> Useful information that a reader should notice, even when skimming.

## Tip

> [!TIP]
> A shortcut: select text and the formatting menu appears above it.

## Important

> [!IMPORTANT]
> Information a reader needs in order to succeed.

## Warning

> [!WARNING]
> Something that could go wrong, or that needs care.

## Caution

> [!CAUTION]
> A risk with a negative outcome.

## Callouts with content

> [!NOTE]
> A callout can hold more than a sentence:
>
> - a list item
> - another list item
>
> and even a fenced block:
>
> ```ts
> const inside = true
> ```

> [!TIP]
> ## A heading inside a callout
>
> Callouts accept most block content, including headings and tables.
>
> | Key | Value |
> | --- | --- |
> | a | 1 |

## Nesting

> A plain quote that contains a callout:
>
> > [!WARNING]
> > Nested one level deep.

> [!NOTE]
> A callout that contains a quote:
>
> > The inner quote is plain.

## A callout between paragraphs

The paragraph before the callout stays close to it.

> [!IMPORTANT]
> This one sits in the middle of the document, between two paragraphs.

The paragraph after it continues the section.
