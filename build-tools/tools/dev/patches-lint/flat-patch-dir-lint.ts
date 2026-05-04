import * as fsp from "node:fs/promises";
import path from "node:path";
import { validateFlatDir } from "../../lib/provider-sync";
import { decodeNameVersionFromPatchLoose } from "../../lib/providers";
import { isKeeperOrDotfile, isPatchFile } from "./fs";
import type { PatchesLintConfig, Violation } from "./types";

type CommonNameVersionMessages = {
  nonPatchInDir: string;
  missingAt: string;
  emptyNameVersion: string;
  mustBeEncoded: string;
};

function messagesForLang(lang: "go" | "node" | "python"): CommonNameVersionMessages {
  if (lang === "go") {
    return {
      nonPatchInDir: "non-patch file in patches/go",
      missingAt: "invalid filename (missing @)",
      emptyNameVersion: "invalid filename (empty import/version)",
      mustBeEncoded: "import path must be encoded ('/' -> '__')",
    };
  }
  if (lang === "node") {
    return {
      nonPatchInDir: "non-patch file in patches/node",
      missingAt: "invalid filename (missing @)",
      emptyNameVersion: "invalid filename (empty name/version)",
      mustBeEncoded: "package name must be encoded ('/' -> '__')",
    };
  }
  return {
    nonPatchInDir: "non-patch file in patches/python",
    missingAt: "invalid filename (missing @)",
    emptyNameVersion: "invalid filename (empty name/version)",
    mustBeEncoded: "package name must be encoded ('/' -> '__')",
  };
}

function validateCommonNameVersionFilename(
  cfg: PatchesLintConfig,
  lang: "go" | "node" | "python",
  file: string,
  violations: Violation[],
): void {
  if (isKeeperOrDotfile(file)) return;

  const msg = messagesForLang(lang);
  const level = cfg.strict ? "error" : "warn";
  if (!isPatchFile(file)) {
    violations.push({
      level,
      code: "nonpatch",
      lang,
      file,
      message: `[${lang}] ${msg.nonPatchInDir}: ${file}`,
    });
    return;
  }

  const base = file.slice(0, -".patch".length);
  const at = base.lastIndexOf("@");
  if (at < 0) {
    violations.push({
      level,
      code: "filename_shape",
      lang,
      file,
      message: `[${lang}] ${msg.missingAt}: ${file}`,
    });
    return;
  }

  const enc = base.slice(0, at);
  const ver = base.slice(at + 1);
  if (!enc || !ver) {
    violations.push({
      level,
      code: "filename_shape",
      lang,
      file,
      message: `[${lang}] ${msg.emptyNameVersion}: ${file}`,
    });
    return;
  }

  if (enc.includes("/")) {
    violations.push({
      level,
      code: "filename_shape",
      lang,
      file,
      message: `[${lang}] ${msg.mustBeEncoded}: ${file}`,
    });
  }
}

export type FlatPatchDirLintOptions = {
  cfg: PatchesLintConfig;
  lang: "go" | "node" | "python";
  patchDirAbs: string;
  duplicateViolationFilePath: (base: string) => string;
  duplicateCandidates?: string[];
};

export async function lintFlatPatchDir(opts: FlatPatchDirLintOptions): Promise<Violation[]> {
  const { cfg, lang, patchDirAbs, duplicateViolationFilePath, duplicateCandidates } = opts;

  await validateFlatDir(patchDirAbs, cfg.strict);

  const violations: Violation[] = [];
  let entries: Array<{ name: string; isDirectory(): boolean }> = [];
  try {
    entries = (await fsp.readdir(patchDirAbs, { withFileTypes: true } as any)) as Array<{
      name: string;
      isDirectory(): boolean;
    }>;
  } catch {
    entries = [];
  }

  const fileNames = entries
    .filter((e) => !e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));

  for (const name of fileNames) {
    validateCommonNameVersionFilename(cfg, lang, name, violations);
  }

  const candidates = (duplicateCandidates || fileNames)
    .filter((n) => !isKeeperOrDotfile(n))
    .filter((n) => isPatchFile(n))
    .slice()
    .sort((a, b) => a.localeCompare(b));

  const byKey = new Map<string, string>();
  for (const n of candidates) {
    const key = decodeNameVersionFromPatchLoose(n);
    if (!key) continue;
    const prior = byKey.get(key);
    if (prior && prior !== n) {
      violations.push({
        level: "error",
        code: "duplicate",
        lang,
        moduleKey: key,
        file: duplicateViolationFilePath(n),
        message: `[${lang}] duplicate patch for ${key}: ${prior} vs ${n}`,
      });
    } else {
      byKey.set(key, n);
    }
  }

  return violations;
}
