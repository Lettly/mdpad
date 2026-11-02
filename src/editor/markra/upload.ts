import { defineMarkraPlugin, type MarkraPlugin } from '@markra/editor/codemirror'

const KEYWORDS = ['upload', 'attach', 'image', 'picture', 'pdf', 'file', 'asset']

/**
 * File uploads belong with the other block commands: the slash menu lists them
 * and the right-click menu offers them, so the writing surface stays the only
 * place actions live.
 */
export function mdpadUploadPlugin(options: { onUpload: () => void }): MarkraPlugin {
  return defineMarkraPlugin({
    id: 'mdpad.upload',
    commands: [
      {
        id: 'mdpad.upload',
        label: 'Upload files',
        run: () => {
          options.onUpload()
          return true
        },
      },
    ],
    ui: [
      {
        command: 'mdpad.upload',
        group: 'file',
        icon: 'upload',
        keywords: KEYWORDS,
        label: 'Upload files…',
        placement: 'context-menu',
      },
      {
        command: 'mdpad.upload',
        group: 'insert',
        icon: 'upload',
        keywords: KEYWORDS,
        label: 'Upload files…',
        order: 150,
        placement: 'slash-menu',
      },
    ],
  })
}
