/** Build absolute URL for REST paths (avoids nested template literals in fetch helpers). */
export function joinApiPath(baseUrl: string, path: string): string {
  if (path.startsWith("http")) {
    return path;
  }
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${suffix}`;
}
