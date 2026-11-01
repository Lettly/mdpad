/**
 * Stand-in for `@tauri-apps/api/core`.
 *
 * `@markra/markdown` uses `convertFileSrc` to point `<img>` tags at local files
 * inside the desktop app. mdpad is a browser app and never takes that path, so
 * the import only has to exist; calling it is a bug and throws.
 */

export function convertFileSrc(path: string): string {
  throw new Error(`Local file access is not available in the browser: ${path}`);
}
