import path from "node:path";
import {
  computeImporterLabel,
  defaultImporterPatchDir,
  findImporterLockfiles,
  listImporterPatches,
} from "../../lib/importers.ts";
import { lintFlatPatchDir } from "./flat-patch-dir-lint.ts";
import { countErrors, reportViolations } from "./report.ts";
import type { PatchesLintConfig, Violation } from "./types.ts";

export async function lintPython(cfg: PatchesLintConfig): Promise<number> {
  const lockfiles = await findImporterLockfiles(["uv.lock"]);
  if (!lockfiles.length) return 0;

  const violations: Violation[] = [];
  for (const lf of lockfiles) {
    const importer = computeImporterLabel(lf);
    const patchDirPosix = defaultImporterPatchDir(importer, "python");
    const patchDirAbs = path.resolve(patchDirPosix);
    const patchFiles = await listImporterPatches(importer, "python");
    const duplicateCandidates = patchFiles.map((rel) => path.posix.basename(rel));

    const vs = await lintFlatPatchDir({
      cfg,
      lang: "python",
      patchDirAbs,
      duplicateCandidates,
      duplicateViolationFilePath: (base) => path.posix.join(patchDirPosix, base),
    });
    violations.push(...vs);
  }

  reportViolations(cfg, violations);
  return countErrors(violations);
}
