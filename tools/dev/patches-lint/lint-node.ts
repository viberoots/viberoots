import * as fsp from "node:fs/promises";
import path from "node:path";
import { decodeNameVersionFromPatch } from "../../lib/providers.ts";
import { validateFlatDir } from "../../lib/provider-sync.ts";
import type { PatchesLintConfig, Violation } from "./types.ts";
import { isKeeperOrDotfile, isPatchFile, pathExists } from "./fs.ts";
import { countErrors, reportViolations } from "./report.ts";

function validateNodePatchFilename(cfg: PatchesLintConfig, file: string, violations: Violation[]) {
  if (isKeeperOrDotfile(file)) return;
  if (!isPatchFile(file)) {
    violations.push({
      level: cfg.strict ? "error" : "warn",
      code: "nonpatch",
      lang: "node",
      file,
      message: `[node] non-patch file in patches/node: ${file}`,
    });
    return;
  }
  const base = file.slice(0, -".patch".length);
  const at = base.lastIndexOf("@");
  if (at < 0) {
    violations.push({
      level: cfg.strict ? "error" : "warn",
      code: "filename_shape",
      lang: "node",
      file,
      message: `[node] invalid filename (missing @): ${file}`,
    });
    return;
  }
  const enc = base.slice(0, at);
  const ver = base.slice(at + 1);
  if (!enc || !ver) {
    violations.push({
      level: cfg.strict ? "error" : "warn",
      code: "filename_shape",
      lang: "node",
      file,
      message: `[node] invalid filename (empty name/version): ${file}`,
    });
    return;
  }
  if (enc.includes("/")) {
    violations.push({
      level: cfg.strict ? "error" : "warn",
      code: "filename_shape",
      lang: "node",
      file,
      message: `[node] package name must be encoded ('/' -> '__'): ${file}`,
    });
  }
}

export async function lintNode(cfg: PatchesLintConfig): Promise<number> {
  const dir = path.join("patches", "node");
  if (!(await pathExists(dir))) return 0;

  await validateFlatDir(dir, cfg.strict).catch((e) => {
    throw e;
  });

  const violations: Violation[] = [];
  const byKey = new Map<string, string>();

  const entries = await fsp.readdir(dir, { withFileTypes: true } as any);
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) continue;
    validateNodePatchFilename(cfg, e.name, violations);
    if (!isPatchFile(e.name)) continue;
    const key = decodeNameVersionFromPatch(e.name);
    if (!key) continue;
    const prior = byKey.get(key);
    if (prior && prior !== e.name) {
      violations.push({
        level: "error",
        code: "duplicate",
        lang: "node",
        moduleKey: key,
        file: e.name,
        message: `[node] duplicate patch for ${key}: ${prior} vs ${e.name}`,
      });
    } else {
      byKey.set(key, e.name);
    }
  }

  reportViolations(cfg, violations);
  return countErrors(violations);
}
