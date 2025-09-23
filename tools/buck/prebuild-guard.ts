#!/usr/bin/env zx-wrapper
// tools/buck/prebuild-guard.ts
import fs from "fs-extra";
import path from "node:path";

type Mode = "ci" | "local";
const mode: Mode = process.env.CI === "true" ? "ci" : "local";
const skewMs = Number(process.env.PREBUILD_GUARD_SKEW_MS || "2000");
const noFix = process.env.PREBUILD_GUARD_NO_FIX === "1";
// CLI flags
const argv = process.argv.slice(2);
const flagVerbose = argv.includes("--verbose") || process.env.PREBUILD_GUARD_VERBOSE === "1";
const jsonOut = argv.includes("--json");
function getVerboseLimit(): number {
  const idx = argv.indexOf("--verbose-limit");
  if (idx >= 0 && argv[idx + 1]) {
    const n = Number(argv[idx + 1]);
    if (Number.isFinite(n) && n > 0) return n;
  }
  const envN = Number(process.env.PREBUILD_GUARD_LIST_LIMIT || "10");
  return Number.isFinite(envN) && envN > 0 ? envN : 10;
}
const verboseLimit = getVerboseLimit();

function mtimeSafe(p: string): number | null {
  try {
    return fs.statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

async function listInputs(): Promise<string[]> {
  // Prefer git for speed and determinism
  try {
    const { stdout } = await $`git ls-files -z`;
    const raw = String(stdout || "");
    const files = raw.split("\0").filter(Boolean);
    return files.filter(
      (f) =>
        f === "TARGETS" ||
        f.endsWith("/TARGETS") ||
        f.endsWith(".bzl") ||
        (f.startsWith("patches/") && f.endsWith(".patch")) ||
        f.endsWith("pnpm-lock.yaml"),
    );
  } catch {
    // Fallback: manual crawl without external deps (globby not guaranteed available in temp repo)
    const result: string[] = [];
    const root = process.cwd();
    const ignoreDirs = new Set([
      ".git",
      "buck-out",
      "node_modules",
      "coverage",
      ".clinic",
      ".direnv",
      "result",
    ]);
    async function walk(dir: string) {
      let entries: fs.Dirent[] = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const rel = path.relative(root, path.join(dir, e.name));
        if (e.isDirectory()) {
          if (ignoreDirs.has(e.name)) continue;
          await walk(path.join(dir, e.name));
        } else {
          if (
            e.name === "TARGETS" ||
            e.name.endsWith(".bzl") ||
            (rel.startsWith("patches/") && e.name.endsWith(".patch")) ||
            e.name === "pnpm-lock.yaml"
          ) {
            result.push(rel);
          }
        }
      }
    }
    await walk(root);
    return result;
  }
}

function listOutputs(): string[] {
  const outs = ["tools/buck/graph.json", "third_party/providers/auto_map.bzl"];
  // Include all provider auto files
  try {
    const dir = "third_party/providers";
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      if (/^TARGETS.*\.auto$/.test(f)) outs.push(path.join(dir, f));
    }
  } catch {}
  return outs;
}

function hasPatchesOrLocks(inputs: string[]): boolean {
  return (
    inputs.some((f) => f.startsWith("patches/") && f.endsWith(".patch")) ||
    inputs.some((f) => f.endsWith("pnpm-lock.yaml"))
  );
}

function missingProviderAutos(): boolean {
  try {
    const dir = "third_party/providers";
    if (!fs.existsSync(dir)) return true;
    return !fs.readdirSync(dir).some((f) => /^TARGETS.*\.auto$/.test(f));
  } catch {
    return true;
  }
}

async function runFixSteps() {
  // Ensure Buck prelude is mapped locally so exporter can query Buck graph in temp workspaces
  try {
    const cfgPath = path.join(process.cwd(), ".buckconfig");
    const cfgTxt = [
      "[buildfile]",
      "name = TARGETS",
      "",
      "[repositories]",
      "root = .",
      "prelude = ./prelude",
      "toolchains = ./toolchains",
      "repo_toolchains = ./toolchains",
      "fbsource = ./prelude/third-party/fbsource_stub",
      "fbcode = ./prelude/third-party/fbcode_stub",
      "config = ./prelude",
      "",
      "[cells]",
      "root = .",
      "prelude = ./prelude",
      "toolchains = ./toolchains",
      "repo_toolchains = ./toolchains",
      "fbsource = ./prelude/third-party/fbsource_stub",
      "fbcode = ./prelude/third-party/fbcode_stub",
      "config = ./prelude",
      "",
      "[build]",
      "prelude = prelude",
      "",
    ].join("\n");
    let hasMapping = false;
    try {
      const txt = await fs.readFile(cfgPath, "utf8");
      const hasRepo = /\[repositories\][\s\S]*?^\s*prelude\s*=\s*/m.test(txt);
      const hasCells = /\[cells\][\s\S]*?^\s*prelude\s*=\s*/m.test(txt);
      hasMapping = hasRepo && hasCells;
    } catch {}
    const preludeLocal = fs.existsSync(path.join(process.cwd(), "prelude"));
    if (!hasMapping && preludeLocal) {
      try {
        await fs.writeFile(path.join(process.cwd(), ".buckroot"), "");
      } catch {}
      await fs.outputFile(cfgPath, cfgTxt, "utf8");
    }
    // If still not mapped, best-effort Nix prelude
    if (!preludeLocal) {
      let out = "";
      try {
        const { stdout } = await $({
          stdio: "pipe",
        })`nix build .#buck2-prelude --no-link --accept-flake-config --print-out-paths`;
        out =
          String(stdout || "")
            .trim()
            .split("\n")
            .filter(Boolean)
            .pop() || "";
      } catch {}
      if (!out) {
        try {
          const { stdout } = await $({ stdio: "pipe" })`nix eval --raw .#inputs.buck2.outPath`;
          out = String(stdout || "").trim();
        } catch {}
      }
      if (out) {
        const preludeDir = path.join(out, "prelude");
        try {
          await fs.writeFile(path.join(process.cwd(), ".buckroot"), "");
        } catch {}
        try {
          await fs.remove("prelude");
        } catch {}
        try {
          await fs.symlink(preludeDir, "prelude");
        } catch {}
        await fs.outputFile(cfgPath, cfgTxt, "utf8");
      }
    }
  } catch {}
  const nodeBase = ["--experimental-strip-types", "--import", "./tools/dev/zx-init.mjs"];
  await $({
    stdio: "inherit",
  })`node ${nodeBase} tools/buck/export-graph.ts --out tools/buck/graph.json`;
  await $({ stdio: "inherit" })`node ${nodeBase} tools/buck/sync-providers.ts`;
  await $({
    stdio: "inherit",
  })`node ${nodeBase} tools/buck/gen-auto-map.ts --graph tools/buck/graph.json --out third_party/providers/auto_map.bzl`;
}

function logList(name: string, files: string[], limit = 5) {
  if (!flagVerbose) return;
  const top = files.slice(0, limit);
  for (const f of top) {
    const t = mtimeSafe(f);
    console.error(`${name}: ${t != null ? new Date(t).toISOString() : "(missing)"} ${f}`);
  }
}

function collectDiagnostics(inputs: string[], presentOutputs: string[], missingOutputs: string[]) {
  const now = Date.now();
  const inputsSorted = [...inputs].sort((a, b) => (mtimeSafe(b) || 0) - (mtimeSafe(a) || 0));
  const outputsSorted = [...presentOutputs].sort(
    (a, b) => (mtimeSafe(a) || 0) - (mtimeSafe(b) || 0),
  );
  const inputsNewest = inputsSorted.slice(0, verboseLimit).map((p) => ({
    path: p,
    mtime: mtimeSafe(p) || 0,
    ageMs: Math.max(0, now - (mtimeSafe(p) || now)),
  }));
  const outputsOldest = outputsSorted.slice(0, verboseLimit).map((p) => ({
    path: p,
    mtime: mtimeSafe(p) || 0,
    ageMs: Math.max(0, now - (mtimeSafe(p) || now)),
  }));
  const newestInput = Math.max(
    0,
    ...inputs.map((f) => mtimeSafe(f)).filter((n): n is number => n != null),
  );
  const oldestOutput = Math.min(
    ...presentOutputs.map((f) => mtimeSafe(f)).filter((n): n is number => n != null),
  );
  const ageDeltaMs =
    Number.isFinite(newestInput) && Number.isFinite(oldestOutput)
      ? Math.max(0, newestInput - oldestOutput)
      : 0;
  return {
    inputsNewest,
    outputsOldest,
    missingOutputs,
    summary: {
      inputCount: inputs.length,
      presentOutputCount: presentOutputs.length,
      missingOutputCount: missingOutputs.length,
      maxInputAgeMs: Math.max(0, ...inputsNewest.map((x) => x.ageMs)),
      minOutputAgeMs: outputsOldest.length > 0 ? Math.min(...outputsOldest.map((x) => x.ageMs)) : 0,
      ageDeltaMs,
    },
  };
}

async function main() {
  const inputs = await listInputs();
  const outputs = listOutputs();

  let hasError = false;
  const outPresence: string[] = [];
  for (const o of outputs) {
    if (!fs.existsSync(o)) outPresence.push(o);
  }

  // If patch/lockfiles exist, at least one provider auto must exist
  if (hasPatchesOrLocks(inputs) && missingProviderAutos()) {
    outPresence.push("third_party/providers/TARGETS*.auto");
  }

  const needFixPresence = outPresence.length > 0;

  // Freshness check only if some outputs exist
  const presentOutputs = outputs.filter((o) => fs.existsSync(o));
  let needFixFreshness = false;
  if (presentOutputs.length > 0) {
    const newestInput = Math.max(
      0,
      ...inputs.map((f) => mtimeSafe(f)).filter((n): n is number => n != null),
    );
    const oldestOutput = Math.min(
      ...presentOutputs.map((f) => mtimeSafe(f)).filter((n): n is number => n != null),
    );
    if (Number.isFinite(newestInput) && Number.isFinite(oldestOutput)) {
      if (newestInput > oldestOutput + skewMs) {
        needFixFreshness = true;
        if (mode === "ci") {
          console.error(
            `ERROR: glue is stale. Newest input is newer than outputs by ${Math.round(
              (newestInput - oldestOutput) / 1000,
            )}s`,
          );
          // Show top offenders
          const sortedInputs = [...inputs].sort((a, b) => mtimeSafe(b)! - mtimeSafe(a)!);
          const sortedOutputs = [...presentOutputs].sort((a, b) => mtimeSafe(a)! - mtimeSafe(b)!);
          logList("newer input", sortedInputs, Number(process.env.PREBUILD_GUARD_LIST_LIMIT || 5));
          logList(
            "older output",
            sortedOutputs,
            Number(process.env.PREBUILD_GUARD_LIST_LIMIT || 5),
          );
        }
      }
    }
  }

  const needFix = needFixPresence || needFixFreshness;

  // Optional diagnostics (verbose or JSON)
  if (flagVerbose) {
    const sortedInputs = [...inputs].sort((a, b) => (mtimeSafe(b) || 0) - (mtimeSafe(a) || 0));
    const sortedOutputs = [...presentOutputs].sort(
      (a, b) => (mtimeSafe(a) || 0) - (mtimeSafe(b) || 0),
    );
    logList("newer input", sortedInputs, verboseLimit);
    logList("older output", sortedOutputs, verboseLimit);
    for (const o of outPresence.slice(0, verboseLimit)) {
      console.error(`missing output: ${o}`);
    }
  }
  if (jsonOut) {
    const diag = collectDiagnostics(inputs, presentOutputs, outPresence);
    console.log(JSON.stringify(diag));
    return process.exit(0);
  }

  if (needFix) {
    if (mode === "ci") {
      // In CI, fail fast with presence/freshness details
      for (const o of outPresence) {
        console.error(
          `ERROR: ${o} missing — run glue generation in this order: export-graph → sync-providers → gen-auto-map`,
        );
      }
      process.exit(1);
    }
    if (!noFix) {
      const t0 = Date.now();
      try {
        await runFixSteps();
        console.error(`auto-fixed glue in ${Date.now() - t0}ms`);
      } catch (e) {
        console.error("ERROR: auto-fix failed:", e);
        process.exit(1);
      }
    } else {
      // Local warn-only
      for (const o of outPresence) {
        console.error(`WARN: ${o} missing`);
      }
      if (needFixFreshness) {
        console.error("WARN: glue is stale");
      }
      console.error("HINT: unset PREBUILD_GUARD_NO_FIX to auto-fix locally.");
    }
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
