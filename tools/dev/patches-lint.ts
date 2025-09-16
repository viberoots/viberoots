#!/usr/bin/env zx-wrapper
import fs from "fs-extra";
import path from "node:path";

type Args = {
  strict?: string | boolean;
  lang?: string;
};

const argv = (global as any).argv as Args;
const STRICT = String(argv.strict || "").toLowerCase() === "true" || argv.strict === true;
const LANG = (argv.lang as string) || ""; // optional: scope to one language

type Violation = { level: "warn" | "error"; message: string };

function log(v: Violation) {
  const out = `${v.level === "error" ? "ERROR" : "warning"}: ${v.message}`;
  if (v.level === "error") console.error(out);
  else console.warn(out);
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
      message: `[go] non-patch file in patches/go: ${file}`,
    });
    return;
  }
  const base = file.slice(0, -".patch".length);
  const at = base.lastIndexOf("@");
  if (at < 0) {
    violations.push({
      level: STRICT ? "error" : "warn",
      message: `[go] invalid filename (missing @): ${file}`,
    });
    return;
  }
  const enc = base.slice(0, at);
  const ver = base.slice(at + 1);
  if (!enc || !ver) {
    violations.push({
      level: STRICT ? "error" : "warn",
      message: `[go] invalid filename (empty import/version): ${file}`,
    });
    return;
  }
  if (enc.includes("/")) {
    violations.push({
      level: STRICT ? "error" : "warn",
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
  for (const e of entries) {
    if (e.isDirectory()) {
      violations.push({
        level: STRICT ? "error" : "warn",
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
        message: `[go] duplicate patch for ${key}: ${prior} vs ${e.name}`,
      });
    } else {
      byKey.set(key, e.name);
    }
  }

  for (const v of violations) {
    log(v);
    if (v.level === "error") problems++;
  }
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
