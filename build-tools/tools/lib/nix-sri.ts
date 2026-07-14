export function isCanonicalSha256SRI(value: unknown): value is string {
  return /^sha256-[A-Za-z0-9+/]{43}=$/.test(String(value || ""));
}
