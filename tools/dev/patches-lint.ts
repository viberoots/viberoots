#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { decodeNixAttrFromPatchPrefix, normalizeNixAttr } from "../lib/providers.ts";

type Args = {
  strict?: string | boolean;
  lang?: string;
  format?: string;
};

const argv = (global as any).argv as Args & Record<string, any>;
// Treat presence of --strict (with or without value) as true, unless explicitly false/0/no
function isExplicitFalse(v: any): boolean {
  const s = String(v).toLowerCase();
  return v === false || s === "false" || s === "0" || s === "no";
}
const HAS_STRICT = Object.prototype.hasOwnProperty.call(argv, "strict");
const STRICT = HAS_STRICT ? !isExplicitFalse((argv as any).strict) : false;
const LANG = (argv.lang as string) || ""; // optional: scope to one language
const FORMAT = ((argv.format as string) || "text").toLowerCase();

type Violation = {
  level: "warn" | "error";
  message: string;
  code: string;
  lang: string;
  file?: string;
  moduleKey?: string;
};

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

function isPatchFile(file: string): boolean {
  return file.endsWith(".patch");
}

// PNPM-like encoding for Go import paths: '/' -> '__'
function decodeGoEnc(enc: string): string {
  return enc.replace(/__/g, "/");
}

// PNPM-like encoding for Node package names (scoped allowed): '/' -> '__'
function decodeNodeEnc(enc: string): string {
  return enc.replace(/__/g, "/");
}

function validateGoPatchFilename(file: string, violations: Violation[]) {
  if (!isPatchFile(file)) {
    violations.push({
      level: STRICT ? "error" : "warn",
      code: "nonpatch",
      lang: "go",
      file,
      message: `[go] non-patch file in patches/go: ${file}`,
    });
    return;
  }
  const base = file.slice(0, -".patch".length);
  const at = base.lastIndexOf("@");
  if (at < 0) {
    violations.push({
      level: STRICT ? "error" : "warn",
      code: "filename_shape",
      lang: "go",
      file,
      message: `[go] invalid filename (missing @): ${file}`,
    });
    return;
  }
  const enc = base.slice(0, at);
  const ver = base.slice(at + 1);
  if (!enc || !ver) {
    violations.push({
      level: STRICT ? "error" : "warn",
      code: "filename_shape",
      lang: "go",
      file,
      message: `[go] invalid filename (empty import/version): ${file}`,
    });
    return;
  }
  if (enc.includes("/")) {
    violations.push({
      level: STRICT ? "error" : "warn",
      code: "filename_shape",
      lang: "go",
      file,
      message: `[go] import path must be encoded ('/' -> '__'): ${file}`,
    });
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function lintGo(): Promise<number> {
  const dir = path.join("patches", "go");
  if (!(await pathExists(dir))) return 0;
  let problems = 0;
  const violations: Violation[] = [];
  const byKey = new Map<string, string>(); // lowercased "import@version" -> filename

  const entries = await fsp.readdir(dir, { withFileTypes: true } as any);
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) {
      violations.push({
        level: STRICT ? "error" : "warn",
        code: "subdir",
        lang: "go",
        file: path.join("patches/go", e.name),
        message: `[go] ignoring subdirectory ${e.name}`,
      });
      continue;
    }
    validateGoPatchFilename(e.name, violations);
    if (!isPatchFile(e.name)) continue;
    const base = e.name.slice(0, -".patch".length);
    const at = base.lastIndexOf("@");
    if (at < 0) continue;
    const enc = base.slice(0, at);
    const ver = base.slice(at + 1);
    if (!enc || !ver) continue;
    const key = `${decodeGoEnc(enc)}@${ver}`.toLowerCase();
    const prior = byKey.get(key);
    if (prior && prior !== e.name) {
      violations.push({
        level: "error",
        code: "duplicate",
        lang: "go",
        moduleKey: key,
        file: e.name,
        message: `[go] duplicate patch for ${key}: ${prior} vs ${e.name}`,
      });
    } else {
      byKey.set(key, e.name);
    }
  }

  // Deterministic output: sort by file then code then message
  violations.sort(
    (a, b) =>
      (a.file || "").localeCompare(b.file || "") ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );

  if (FORMAT === "json") printJson(violations);
  else printHuman(violations);

  for (const v of violations) if (v.level === "error") problems++;
  return problems;
}

function validateNodePatchFilename(file: string, violations: Violation[]) {
  if (!isPatchFile(file)) {
    violations.push({
      level: STRICT ? "error" : "warn",
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
      level: STRICT ? "error" : "warn",
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
      level: STRICT ? "error" : "warn",
      code: "filename_shape",
      lang: "node",
      file,
      message: `[node] invalid filename (empty name/version): ${file}`,
    });
    return;
  }
  if (enc.includes("/")) {
    violations.push({
      level: STRICT ? "error" : "warn",
      code: "filename_shape",
      lang: "node",
      file,
      message: `[node] package name must be encoded ('/' -> '__'): ${file}`,
    });
  }
}

async function lintNode(): Promise<number> {
  const dir = path.join("patches", "node");
  if (!(await pathExists(dir))) return 0;
  let problems = 0;
  const violations: Violation[] = [];
  const byKey = new Map<string, string>(); // lowercased "name@version" -> filename

  const entries = await fsp.readdir(dir, { withFileTypes: true } as any);
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) {
      violations.push({
        level: STRICT ? "error" : "warn",
        code: "subdir",
        lang: "node",
        file: path.join("patches/node", e.name),
        message: `[node] ignoring subdirectory ${e.name}`,
      });
      continue;
    }
    validateNodePatchFilename(e.name, violations);
    if (!isPatchFile(e.name)) continue;
    const base = e.name.slice(0, -".patch".length);
    const at = base.lastIndexOf("@");
    if (at < 0) continue;
    const enc = base.slice(0, at);
    const ver = base.slice(at + 1);
    if (!enc || !ver) continue;
    const key = `${decodeNodeEnc(enc)}@${ver}`.toLowerCase();
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

  violations.sort(
    (a, b) =>
      (a.file || "").localeCompare(b.file || "") ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );

  if (FORMAT === "json") printJson(violations);
  else printHuman(violations);

  for (const v of violations) if (v.level === "error") problems++;
  return problems;
}

function validateCppPatchFilename(file: string, violations: Violation[]) {
  if (!isPatchFile(file)) {
    violations.push({
      level: STRICT ? "error" : "warn",
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
      level: STRICT ? "error" : "warn",
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
      level: STRICT ? "error" : "warn",
      code: "filename_shape",
      lang: "cpp",
      file,
      message: `[cpp] invalid filename (empty attr/version): ${file}`,
    });
    return;
  }
  // For C++ (nixpkgs attrs), the encoded prefix must not contain '.' or '/'.
  if (enc.includes("/") || enc.includes(".")) {
    violations.push({
      level: STRICT ? "error" : "warn",
      code: "filename_shape",
      lang: "cpp",
      file,
      message: `[cpp] nixpkgs attr must be encoded ('.' or '/' not allowed; use '__'): ${file}`,
    });
  }
  // Best-effort decode/normalize to catch obviously invalid prefixes early.
  const decoded = decodeNixAttrFromPatchPrefix(enc);
  if (!decoded || !decoded.startsWith("pkgs.")) {
    violations.push({
      level: STRICT ? "error" : "warn",
      code: "filename_shape",
      lang: "cpp",
      file,
      message: `[cpp] invalid nixpkgs attribute prefix: ${enc} -> ${decoded || "<empty>"}`,
    });
  }
}

async function lintCpp(): Promise<number> {
  const dir = path.join("patches", "cpp");
  if (!(await pathExists(dir))) return 0;
  let problems = 0;
  const violations: Violation[] = [];
  const byKey = new Map<string, string>(); // lowercased "nixAttr@version" -> filename

  const entries = await fsp.readdir(dir, { withFileTypes: true } as any);
  for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (e.isDirectory()) {
      violations.push({
        level: STRICT ? "error" : "warn",
        code: "subdir",
        lang: "cpp",
        file: path.join("patches/cpp", e.name),
        message: `[cpp] ignoring subdirectory ${e.name}`,
      });
      continue;
    }
    validateCppPatchFilename(e.name, violations);
    if (!isPatchFile(e.name)) continue;
    const base = e.name.slice(0, -".patch".length);
    const at = base.lastIndexOf("@");
    if (at < 0) continue;
    const enc = base.slice(0, at);
    const ver = base.slice(at + 1);
    if (!enc || !ver) continue;
    // Decode to canonical nix attr and normalize for duplicate detection
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

  violations.sort(
    (a, b) =>
      (a.file || "").localeCompare(b.file || "") ||
      a.code.localeCompare(b.code) ||
      a.message.localeCompare(b.message),
  );

  if (FORMAT === "json") printJson(violations);
  else printHuman(violations);

  for (const v of violations) if (v.level === "error") problems++;
  return problems;
}

async function main() {
  let problems = 0;
  const langs = ["go", "node", "cpp"];
  for (const l of langs) {
    if (LANG && LANG !== l) continue;
    if (l === "go") problems += await lintGo();
    else if (l === "node") problems += await lintNode();
    else if (l === "cpp") problems += await lintCpp();
  }
  if (STRICT && problems > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
