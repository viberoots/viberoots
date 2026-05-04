import type { PatchesLintConfig, Violation } from "./types";

function printHuman(vs: Violation[]) {
  for (const v of vs) {
    const out = `${v.level === "error" ? "ERROR" : "warning"}: ${v.message}`;
    if (v.level === "error") console.error(out);
    else console.warn(out);
  }
}

function printJson(vs: Violation[]) {
  console.log(JSON.stringify(vs, null, 2));
}

export function sortViolationsDeterministically(vs: Violation[]): void {
  vs.sort(
    (a, b) =>
      (a.file || "").localeCompare(b.file || "") ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );
}

export function reportViolations(cfg: PatchesLintConfig, vs: Violation[]): void {
  sortViolationsDeterministically(vs);
  if (cfg.format === "json") printJson(vs);
  else printHuman(vs);
}

export function countErrors(vs: Violation[]): number {
  let n = 0;
  for (const v of vs) if (v.level === "error") n++;
  return n;
}
