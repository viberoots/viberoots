#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";

type Args = {
  strict?: string | boolean;
  lang?: string;
  format?: string;
};

const argv = (global as any).argv as Args;
const STRICT = String(argv.strict || "").toLowerCase() === "true" || argv.strict === true;
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

async function lintGo(): Promise<number> {
  const dir = path.join("patches", "go");
  if (!(await fs.pathExists(dir))) return 0;
  let problems = 0;
  const violations: Violation[] = [];
  const byKey = new Map<string, string>(); // lowercased "import@version" -> filename

  const entries = await fs.readdir(dir, { withFileTypes: true });
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

async function main() {
  let problems = 0;
  const langs = ["go"]; // extend later (e.g., 'node')
  for (const l of langs) {
    if (LANG && LANG !== l) continue;
    if (l === "go") problems += await lintGo();
  }
  if (STRICT && problems > 0) process.exit(2);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
