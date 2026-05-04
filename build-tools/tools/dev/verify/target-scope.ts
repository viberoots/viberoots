import { packagePathFromLabel } from "../../lib/labels";
import { isNonBuildSystemScopeRoot } from "../../lib/non-build-system-scope";

function normalizeTarget(raw: string): string {
  return String(raw || "").trim();
}

function packageScopePath(target: string): string {
  if (target.endsWith("/...") && !target.includes(":")) {
    return target.slice(2, -"/...".length);
  }
  if (!target.startsWith("//") || target.startsWith("//:")) {
    return "";
  }
  return packagePathFromLabel(target);
}

export function isNonBuildSystemOnlyVerifyTargets(targets: string[]): boolean {
  if (targets.length === 0) return false;
  return targets.every((raw) => {
    const t = normalizeTarget(raw);
    if (!t.startsWith("//")) return false;
    if (t === "//..." || t.includes("(") || t.includes(")") || t.includes("*") || t.includes("?"))
      return false;
    const scopePath = packageScopePath(t);
    return !!scopePath && isNonBuildSystemScopeRoot(scopePath);
  });
}
