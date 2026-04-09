/**
 * Helpers for Google Drive API `q` query strings (files.list).
 * @see https://developers.google.com/drive/api/guides/search-files
 */
export function escapeDriveQueryLiteral(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}
