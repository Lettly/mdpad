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

Images scale to the width of the column; nothing is cropped.

## Missing image

A broken reference shows its alt text instead of an image:

![A picture that does not exist](./does-not-exist.png)

## Images inside blocks

> A quote with an image:
>
> ![The GitHub mark](https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png)

- A list item with an image:

  ![The GitHub mark](https://github.githubassets.com/images/modules/logos_page/GitHub-Mark.png)

## Repo-relative paths

In a repository, a relative path resolves against the file's folder:

```md
![Diagram](./assets/diagram.png)
```

Click an image in the preview to open it larger.
