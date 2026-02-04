export const LOCKFILE_BASENAMES_BY_LANG: Record<string, string[]> = {
  node: ["pnpm-lock.yaml"],
  python: ["uv.lock"],
};

export function lockfileBasenamesForLang(lang: string): string[] | null {
  if (!lang) return null;
  return LOCKFILE_BASENAMES_BY_LANG[lang] || null;
}

export function defaultLockfileBasenameForLang(lang: string): string {
  const basenames = lockfileBasenamesForLang(lang);
  if (!basenames || basenames.length === 0) {
    throw new Error(`missing lockfile basename for lang: ${String(lang)}`);
  }
  return basenames[0];
}
