function normalizeTarget(raw: string): string {
  return String(raw || "").trim();
}

export function isProjectsOnlyVerifyTargets(targets: string[]): boolean {
  if (targets.length === 0) return false;
  return targets.every((raw) => {
    const t = normalizeTarget(raw);
    if (!t.startsWith("//")) return false;
    if (t === "//..." || t.includes("(") || t.includes(")") || t.includes("*") || t.includes("?"))
      return false;
    return t.startsWith("//projects/");
  });
}
