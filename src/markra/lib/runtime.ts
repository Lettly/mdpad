/**
 * Stand-in for Markra's desktop/browser runtime. The editor surface asks it for
 * the clipboard and whether a native event bridge exists; in mdpad the answer
 * is the browser's own clipboard and "no bridge".
 */

export function getAppRuntime() {
  return {
    events: {
      isAvailable: () => false,
    },
    menu: {
      readClipboardText: () => {
        try {
          return navigator.clipboard?.readText?.() ?? null
        } catch {
          return null
        }
      },
    },
  }
}
