# Images

## Markdown syntax

![The GitHub mark](https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png)

With a title:

![The GitHub mark](https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png 'GitHub')

## An image that links somewhere

[![The GitHub mark](https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png)](https://github.com)

## Reference style

![Octocat][octocat]

[octocat]: https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png

## Size

A wide image:

![A wide banner](https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png)

Images scale to the width of the column; nothing is cropped. An SVG that carries only a `viewBox`
and no `width`/`height` has no intrinsic size, so it fills the column the way GitHub renders it too —
add `width` and `height` to the SVG, or write it as `<img width="…">`, to keep it small.

## Missing image

A broken reference shows its alt text instead of an image:

![A picture that does not exist](./does-not-exist.png)

## Images inside blocks

> A quote with an image:
>
> ![The GitHub mark](https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png)

- A list item with an image:

  ![The GitHub mark](https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png)
## Test Upload
![favicon (1)](img/favicon%20%281%29.png)


## Repo-relative paths

A relative path resolves against the folder this file lives in, so this one points at
`public/favicon.svg` at the root of the repository:

![The mdpad icon](../public/favicon.svg)

```md
![The mdpad icon](../public/favicon.svg)
```

An absolute-from-root path works too: `![The icon](/public/favicon.svg)`.

Click an image in the preview to open it larger.
