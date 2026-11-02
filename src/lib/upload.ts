/**
 * Turning picked files into Markdown: which ones the editor can show inline,
 * where they land in the repository, and how to link them from the document.
 */

export type UploadItem = {
  file: File
  /** File name as it will be committed, unique within the destination folder. */
  name: string
  /** Repository path, folder included. */
  path: string
  size: number
}

/** Markdown image syntax only renders formats GitHub treats as pictures. */
const IMAGE_EXTENSIONS = new Set([
  'apng',
  'avif',
  'bmp',
  'gif',
  'ico',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
])

const UNSAFE_NAME = /[/\\]/g

export function sanitizeFileName(name: string): string {
  const cleaned = name.replace(UNSAFE_NAME, '-').replace(/\p{Cc}/gu, '').trim()
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'file'
  return cleaned
}

/** `assets//img/` → `assets/img`; an empty string is the repository root. */
export function normalizeFolder(input: string): string {
  return input
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '' && part !== '.')
    .join('/')
}

/** Repository paths never climb above the root, so `..` is a typo. */
export function isValidFolder(input: string): boolean {
  return !input.split('/').some((part) => part.trim() === '..')
}

export function folderOf(path: string): string {
  const parts = path.split('/')
  parts.pop()
  return parts.join('/')
}

export function joinFolder(folder: string, name: string): string {
  return folder ? `${folder}/${name}` : name
}

/** `docs/guide.md` + `assets/logo.png` → `../assets/logo.png` */
export function relativePath(documentPath: string, targetPath: string): string {
  const from = documentPath.split('/').slice(0, -1).filter(Boolean)
  const to = targetPath.split('/').filter(Boolean)

  let shared = 0
  while (shared < from.length && shared < to.length - 1 && from[shared] === to[shared]) shared += 1

  return [...from.slice(shared).map(() => '..'), ...to.slice(shared)].join('/')
}

/** Spaces and parentheses would end the link destination early. */
export function encodeMarkdownPath(path: string): string {
  return path
    .split('/')
    .map((part) =>
      encodeURIComponent(part).replace(/\(/g, '%28').replace(/\)/g, '%29'),
    )
    .join('/')
}

export function isImageName(name: string): boolean {
  const dot = name.lastIndexOf('.')
  return dot > 0 && IMAGE_EXTENSIONS.has(name.slice(dot + 1).toLowerCase())
}

function altText(name: string): string {
  const base = name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
  return (base || name).replace(/[[\]]/g, '')
}

function escapeLabel(name: string): string {
  return name.replace(/([[\]])/g, '\\$1')
}

/** The snippet that puts an uploaded file into the document. */
export function markdownForUpload(documentPath: string, targetPath: string): string {
  const href = encodeMarkdownPath(relativePath(documentPath, targetPath))
  const name = targetPath.split('/').pop() ?? targetPath
  return isImageName(name) ? `![${altText(name)}](${href})` : `[${escapeLabel(name)}](${href})`
}

function uniqueName(name: string, folder: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.')
  const base = dot > 0 ? name.slice(0, dot) : name
  const extension = dot > 0 ? name.slice(dot) : ''

  let candidate = name
  for (let counter = 1; taken.has(joinFolder(folder, candidate)); counter += 1) {
    candidate = `${base}-${counter}${extension}`
  }
  return candidate
}

/**
 * Plans the upload: names are de-duplicated against the repository and against
 * the other files of the same batch, so nothing is silently overwritten.
 */
export function buildItems(
  files: readonly File[],
  folder: string,
  taken: ReadonlySet<string>,
): UploadItem[] {
  const used = new Set(taken)

  return files.map((file) => {
    const name = uniqueName(sanitizeFileName(file.name), folder, used)
    const path = joinFolder(folder, name)
    used.add(path)
    return { file, name, path, size: file.size }
  })
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`
}
