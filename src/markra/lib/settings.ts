/**
 * The slice of Markra's app settings the editor surface reads. mdpad has no
 * settings panel, so these are the defaults the surface expects.
 */

export type TableColumnWidthModePreference = 'auto' | 'even'

export type ExtendedSyntaxPreferences = {
  githubAlerts: boolean
  highlight: boolean
}
