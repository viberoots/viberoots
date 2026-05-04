import * as fsp from "node:fs/promises";
import path from "node:path";
import { decodeNixAttrFromPatchPrefix, normalizeNixAttr } from "../../lib/providers";
import { validateFlatDir } from "../../lib/provider-sync";
import type { PatchesLintConfig, Violation } from "./types";
import { isKeeperOrDotfile, isPatchFile, pathExists } from "./fs";
import { countErrors, reportViolations } from "./report";

function validateCppPatchFilename(cfg: PatchesLintConfig, file: string, violations: Violation[]) {
  if (isKeeperOrDotfile(file)) return;
  if (!isPatchFile(file)) {
    violations.push({
      level: cfg.strict ? "error" : "warn",
      code: "nonpatch",
      lang: "cpp",
      file,
      message: `[cpp] non-patch file in patches/cpp: ${file}`,
    });
    return;
  }
  const base = file.slice(0, -".patch".length);
  const at = base.lastIndexOf("@");
  if (at < 0) {
    violations.push({
      level: cfg.strict ? "error" : "warn",
      code: "filename_shape",
      lang: "cpp",
      file,
      message: `[cpp] invalid filename (missing @): ${file}`,
    });
    return;
  }
  const enc = base.slice(0, at);
  const ver = base.slice(at + 1);
  if (!enc || !ver) {
    violations.push({
      level: cfg.strict ? "error" : "warn",
      code: "filename_shape",
      lang: "cpp",
      file,
      message: `[cpp] invalid filename (empty attr/version): ${file}`,
    });
    return;
  }
  if (enc.includes("/") || enc.includes(".")) {
    violations.push({
      level: cfg.strict ? "error" : "warn",
      code: "filename_shape",
      lang: "cpp",
      file,
      message: `[cpp] nixpkgs attr must be encoded ('.' or '/' not allowed; use '__'): ${file}`,
    });
  }
  const decoded = decodeNixAttrFromPatchPrefix(enc);
  if (!decoded || !decoded.startsWith("pkgs.")) {
    violations.push({
      level: cfg.strict ? "error" : "warn",
      code: "filename_shape",
      lang: "cpp",
      file,
      message: `[cpp] invalid nixpkgs attribute prefix: ${enc} -> ${decoded || "<empty>"}`,
    });
  }
}

export async function lintCpp(cfg: PatchesLintConfig): Promise<number> {
  const dir = path.join("patches", "cpp");
  if (!(await pathExists(dir))) return 0;

  await validateFlatDir(dir, cfg.strict).catch((e) => {
    throw e;
  });

  const violations: Violation[] = [];
  const byKey = new Map<string, string>();

  const entries = await fsp.readdir(dir, { withFileTypes: true } as any);
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) continue;
    validateCppPatchFilename(cfg, e.name, violations);
    if (!isPatchFile(e.name)) continue;
    const base = e.name.slice(0, -".patch".length);
    const at = base.lastIndexOf("@");
    if (at < 0) continue;
    const enc = base.slice(0, at);
    const ver = base.slice(at + 1);
    if (!enc || !ver) continue;
    const attr = normalizeNixAttr(decodeNixAttrFromPatchPrefix(enc));
    const key = `${attr}@${ver}`.toLowerCase();
    const prior = byKey.get(key);
    if (prior && prior !== e.name) {
      violations.push({
        level: "error",
        code: "duplicate",
        lang: "cpp",
        moduleKey: key,
        file: e.name,
        message: `[cpp] duplicate patch for ${key}: ${prior} vs ${e.name}`,
      });
    } else {
      byKey.set(key, e.name);
    }
  }

  reportViolations(cfg, violations);
  return countErrors(violations);
}
