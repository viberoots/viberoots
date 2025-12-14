import * as fsp from "node:fs/promises";
import path from "node:path";
import {
  computeImporterLabel,
  defaultImporterPatchDir,
  findImporterLockfiles,
  listImporterPatches,
} from "../../lib/importers.ts";
import { validateFlatDir } from "../../lib/provider-sync.ts";
import { decodeNameVersionFromPatchLoose } from "../../lib/providers.ts";
import { isKeeperOrDotfile, isPatchFile } from "./fs.ts";
import { countErrors, reportViolations } from "./report.ts";
import type { PatchesLintConfig, Violation } from "./types.ts";

function validatePythonPatchFilename(
  cfg: PatchesLintConfig,
  file: string,
  violations: Violation[],
) {
  if (isKeeperOrDotfile(file)) return;
  if (!isPatchFile(file)) {
    violations.push({
      level: cfg.strict ? "error" : "warn",
      code: "nonpatch",
      lang: "python",
      file,
      message: `[python] non-patch file in patches/python: ${file}`,
    });
    return;
  }
  const base = file.slice(0, -".patch".length);
  const at = base.lastIndexOf("@");
  if (at < 0) {
    violations.push({
      level: cfg.strict ? "error" : "warn",
      code: "filename_shape",
      lang: "python",
      file,
      message: `[python] invalid filename (missing @): ${file}`,
    });
    return;
  }
  const enc = base.slice(0, at);
  const ver = base.slice(at + 1);
  if (!enc || !ver) {
    violations.push({
      level: cfg.strict ? "error" : "warn",
      code: "filename_shape",
      lang: "python",
      file,
      message: `[python] invalid filename (empty name/version): ${file}`,
    });
    return;
  }
  if (enc.includes("/")) {
    violations.push({
      level: cfg.strict ? "error" : "warn",
      code: "filename_shape",
      lang: "python",
      file,
      message: `[python] package name must be encoded ('/' -> '__'): ${file}`,
    });
  }
}

export async function lintPython(cfg: PatchesLintConfig): Promise<number> {
  const lockfiles = await findImporterLockfiles(["uv.lock"]);
  if (!lockfiles.length) return 0;

  const violations: Violation[] = [];
  for (const lf of lockfiles) {
    const importer = computeImporterLabel(lf);
    const patchDirPosix = defaultImporterPatchDir(importer, "python");
    const patchDirAbs = path.resolve(patchDirPosix);

    await validateFlatDir(patchDirAbs, cfg.strict).catch((e) => {
      throw e;
    });

    const patchFiles = await listImporterPatches(importer, "python");
    const byKey = new Map<string, string>();

    let names: string[] = [];
    try {
      names = await fsp.readdir(patchDirAbs);
    } catch {
      names = [];
    }
    for (const n of names.sort((a, b) => a.localeCompare(b))) {
      validatePythonPatchFilename(cfg, n, violations);
    }

    for (const rel of patchFiles) {
      const base = path.posix.basename(rel);
      const key = decodeNameVersionFromPatchLoose(base);
      if (!key) continue;
      const prior = byKey.get(key);
      if (prior && prior !== base) {
        violations.push({
          level: "error",
          code: "duplicate",
          lang: "python",
          moduleKey: key,
          file: path.posix.join(patchDirPosix, base),
          message: `[python] duplicate patch for ${key}: ${prior} vs ${base}`,
        });
      } else {
        byKey.set(key, base);
      }
    }
  }

  reportViolations(cfg, violations);
  return countErrors(violations);
}
