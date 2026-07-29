import "zx/globals";
import * as fsp from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { buildToolPath } from "../dev-build/paths";
import { mkdirWithMacosMetadataExclusion, mkdtempNoindex } from "../../lib/macos-metadata";
import { publishMergedLcovReport } from "./coverage-lcov-report";

async function pathExists(p: string): Promise<boolean> {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function mergeRustLcov(root: string): Promise<void> {
  const rustRoot = path.join(root, "coverage", "rust");
  const inputs: string[] = [];
  const visit = async (current: string): Promise<void> => {
    for (const entry of await fsp.readdir(current, { withFileTypes: true }).catch(() => [])) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(absolute);
      else if (entry.isFile() && entry.name === "lcov.info") inputs.push(absolute);
    }
  };
  await visit(rustRoot);
  if (inputs.length === 0) return;
  const merged = await Promise.all(
    inputs.sort().map(async (input) => {
      const content = await fsp.readFile(input, "utf8");
      return content.endsWith("\n") ? content : `${content}\n`;
    }),
  );
  await fsp.appendFile(path.join(root, "coverage", "lcov.info"), merged.join(""));
}

export async function resolveCoverageC8(root: string): Promise<string | null> {
  const workspaceC8 = path.join(root, "node_modules", "c8", "bin", "c8.js");
  if (await pathExists(workspaceC8)) return workspaceC8;
  const artifactToolsRoot = String(process.env.VBR_ARTIFACT_TOOLS_ROOT || "");
  const artifactC8 = path.join(artifactToolsRoot, "node_modules", "c8", "bin", "c8.js");
  if (artifactToolsRoot.startsWith("/nix/store/") && (await pathExists(artifactC8))) {
    return artifactC8;
  }
  try {
    const managedC8 = createRequire(import.meta.url).resolve("c8/bin/c8.js");
    return managedC8.startsWith("/nix/store/") ? managedC8 : null;
  } catch {
    return null;
  }
}

export async function setupCoverage(opts: {
  root: string;
  enabled: boolean;
}): Promise<{ rawDir: string | null }> {
  if (!opts.enabled) {
    process.env.COVERAGE = "0";
    delete process.env.NODE_V8_COVERAGE;

    // Best-effort cleanup of stale raw coverage dirs (local runs only; avoid cross-run interference in CI).
    if (process.env.CI !== "true") {
      const parent = path.join(opts.root, "buck-out", "tmp", "node-v8-coverage");
      const rawParents = [parent, path.join(parent, "raw.noindex")];
      for (const rawParent of rawParents) {
        if (!(await pathExists(rawParent))) continue;
        await fsp
          .readdir(rawParent)
          .then(async (ents) => {
            for (const e of ents) {
              if (!e.startsWith("v-")) continue;
              await fsp
                .rm(path.join(rawParent, e), { recursive: true, force: true })
                .catch(() => {});
            }
          })
          .catch(() => {});
      }
    }

    return { rawDir: null };
  }

  process.env.COVERAGE = "1";
  const parent = path.join(opts.root, "buck-out", "tmp", "node-v8-coverage");
  const rawDir = await mkdtempNoindex("v-", {
    baseName: "raw",
    tmpBase: parent,
  });
  process.env.NODE_V8_COVERAGE = rawDir;

  // Ensure merged report directory is clean and exists.
  const covDir = path.join(opts.root, "coverage");
  if (await pathExists(covDir)) {
    await $({
      stdio: "ignore",
      cwd: opts.root,
    })`bash --noprofile --norc -c 'set -euo pipefail; chmod -R u+w coverage >/dev/null 2>&1 || true; find coverage -mindepth 1 -maxdepth 1 -print0 2>/dev/null | xargs -0 rm -rf >/dev/null 2>&1 || true; rmdir coverage >/dev/null 2>&1 || true'`.nothrow();
  }
  await mkdirWithMacosMetadataExclusion(covDir).catch(() => {});

  return { rawDir };
}

export async function runMergedCoverageReport(opts: {
  root: string;
  rawDir: string;
}): Promise<void> {
  const c8Js = await resolveCoverageC8(opts.root);
  if (!c8Js) {
    process.stderr.write(
      `error: coverage enabled but c8 is missing from ${path.join(opts.root, "node_modules")} and the managed tool closure\n`,
    );
    process.stderr.write("hint: run 'i' and ensure the viberoots tool closure is complete.\n");
    process.exit(2);
    return;
  }

  const nodeBin = process.env.NODE_BIN || process.execPath;
  const artifactToolsRoot = String(process.env.VBR_ARTIFACT_TOOLS_ROOT || "");
  const managedBinDir = artifactToolsRoot.startsWith("/nix/store/")
    ? path.join(artifactToolsRoot, "bin")
    : path.dirname(nodeBin);

  await $({
    stdio: "ignore",
    cwd: opts.root,
  })`${nodeBin} ${buildToolPath(opts.root, "tools/dev/coverage-raw-normalize.mjs")}`.nothrow();

  await $({
    stdio: "inherit",
    cwd: opts.root,
    env: {
      ...process.env,
      NODE_V8_COVERAGE: opts.rawDir,
      PATH: `${managedBinDir}:${process.env.PATH || ""}`,
    },
  })`${nodeBin} ${c8Js} report --clean=false --temp-directory ${opts.rawDir} --reports-dir ${path.join(
    opts.root,
    "coverage",
  )} --reporter=json-summary --reporter=lcov --reporter=html --merge-async --extension .ts --allowExternal --src ${opts.root} --include **/*.ts --exclude node_modules/** --exclude buck-out/** --exclude .clinic/** --exclude **/*.d.ts`;

  await mergeRustLcov(opts.root);
  await $({
    stdio: "ignore",
    cwd: opts.root,
  })`${nodeBin} ${buildToolPath(opts.root, "tools/dev/coverage-normalize.mjs")}`.nothrow();
  await publishMergedLcovReport(opts.root);
}
