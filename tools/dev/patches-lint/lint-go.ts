import path from "node:path";
import { lintFlatPatchDir } from "./flat-patch-dir-lint.ts";
import { pathExists } from "./fs.ts";
import { countErrors, reportViolations } from "./report.ts";
import type { PatchesLintConfig } from "./types.ts";

export async function lintGo(cfg: PatchesLintConfig): Promise<number> {
  const dir = path.join("patches", "go");
  if (!(await pathExists(dir))) return 0;

  const violations = await lintFlatPatchDir({
    cfg,
    lang: "go",
    patchDirAbs: dir,
    duplicateViolationFilePath: (base) => base,
  });

  reportViolations(cfg, violations);
  return countErrors(violations);
}
