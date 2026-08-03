const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

export const publicBasePath = configuredBasePath
  ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
  : "";

export function withBasePath(path: string): string {
  const absolutePath = path.startsWith("/") ? path : `/${path}`;
  return `${publicBasePath}${absolutePath}`;
}
