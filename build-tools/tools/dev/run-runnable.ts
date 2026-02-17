#!/usr/bin/env zx-wrapper
import { spawn } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getArgvTokens } from "../lib/cli.ts";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const.ts";
import { normalizeTargetLabel, parseLockfileLabel } from "../lib/labels.ts";
import { findRepoRoot } from "../lib/repo.ts";
import {
  findRunnableEntryForTarget,
  readRunnableManifest,
  type RunnableManifestEntry,
} from "../lib/runnables.ts";
import { ensureGraph } from "../buck/glue-run.ts";

function parseArgs(argv: string[]): {
  mode: "prod" | "dev";
  target: string;
  passthrough: string[];
} {
  let mode: "prod" | "dev" = "prod";
  const rest: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const tok = String(argv[i] || "");
    if (tok === "--mode" && i + 1 < argv.length) {
      const m = String(argv[i + 1] || "").trim();
      if (m === "prod" || m === "dev") mode = m;
      i++;
      continue;
    }
    if (tok.startsWith("--mode=")) {
      const m = tok.slice("--mode=".length).trim();
      if (m === "prod" || m === "dev") mode = m;
      continue;
    }
    rest.push(tok);
  }
  const target = String(rest[0] || "").trim();
  return { mode, target, passthrough: rest.slice(1) };
}

async function importerForTarget(workspaceRoot: string, target: string): Promise<string> {
  try {
    const graphTxt = await fsp.readFile(path.join(workspaceRoot, DEFAULT_GRAPH_PATH), "utf8");
    const raw = JSON.parse(graphTxt);
    const nodes = Array.isArray(raw) ? raw : Array.isArray(raw?.nodes) ? raw.nodes : [];
    const want = normalizeTargetLabel(target);
    for (const n of nodes) {
      const name = normalizeTargetLabel(String(n?.name || ""));
      if (name !== want) continue;
      const labels = Array.isArray(n?.labels) ? n.labels : [];
      for (const label of labels) {
        const parsed = parseLockfileLabel(String(label || ""));
        if (parsed?.importer) return parsed.importer;
      }
      return "";
    }
  } catch {}
  return "";
}

async function readManifestEntry(
  manifestPath: string,
  target: string,
): Promise<RunnableManifestEntry | null> {
  try {
    const entries = await readRunnableManifest(manifestPath);
    return findRunnableEntryForTarget(entries, target);
  } catch {
    return null;
  }
}

async function buildRunnableManifest(workspaceRoot: string): Promise<string> {
  const graphPath = path.join(workspaceRoot, DEFAULT_GRAPH_PATH);
  process.env.BUCK_TEST_SRC = workspaceRoot;
  process.env.WORKSPACE_ROOT = workspaceRoot;
  process.env.BUCK_GRAPH_JSON = graphPath;
  await ensureGraph();
  const { stdout, exitCode } = await $({
    cwd: workspaceRoot,
    env: process.env,
    reject: false,
    nothrow: true,
  })`nix build --impure --no-write-lock-file .#graph-generator --accept-flake-config --no-link --print-out-paths`;
  if (exitCode !== 0) throw new Error("failed to build graph-generator for runnable manifest");
  const outPath =
    String(stdout || "")
      .trim()
      .split(/\n+/)
      .filter(Boolean)
      .pop() || "";
  if (!outPath) throw new Error("graph-generator did not emit an output path");
  const linkDir = path.join(workspaceRoot, "buck-out", "tmp");
  const linkPath = path.join(linkDir, "runnable-manifest-current");
  await fsp.mkdir(linkDir, { recursive: true });
  await $({ cwd: workspaceRoot, stdio: "pipe" })`ln -sfn ${outPath} ${linkPath}`;
  return path.join(linkPath, "manifest.json");
}

async function runCommand(argv: string[], extra: string[], cwd?: string): Promise<number> {
  const cmd = String(argv[0] || "").trim();
  if (!cmd) return 2;
  const args = [...argv.slice(1), ...extra];
  const child = spawn(cmd, args, {
    cwd: cwd || process.cwd(),
    stdio: "inherit",
    env: process.env,
  });
  return await new Promise<number>((resolve) => {
    child.once("close", (code, signal) => {
      if (typeof code === "number") resolve(code);
      else resolve(signal ? 130 : 1);
    });
    child.once("error", () => resolve(1));
  });
}

async function main() {
  const parsed = parseArgs(getArgvTokens());
  if (!parsed.target || parsed.target.startsWith("-")) {
    console.error("usage: r <target> [args...]");
    console.error("   or: d <target> [args...]");
    process.exit(2);
  }
  const workspaceRoot = await findRepoRoot(process.cwd());
  const target = parsed.target;
  let entry: RunnableManifestEntry | null = null;
  const testManifestPath = String(process.env.RUNNABLE_TEST_MANIFEST || "").trim();
  if (testManifestPath) {
    entry = await readManifestEntry(testManifestPath, target);
  } else {
    const currentManifestPath = path.join(
      workspaceRoot,
      "buck-out",
      "tmp",
      "runnable-manifest-current",
      "manifest.json",
    );
    entry = await readManifestEntry(currentManifestPath, target);
    if (!entry) {
      const refreshedManifestPath = await buildRunnableManifest(workspaceRoot);
      entry = await readManifestEntry(refreshedManifestPath, target);
    }
  }
  if (!entry?.runnable) {
    console.error(`target is not runnable (or is library-only): ${target}`);
    process.exit(2);
  }
  let spec = parsed.mode === "dev" ? entry.runnable.run.dev : entry.runnable.run.prod;
  if (parsed.mode === "dev" && !spec) {
    const importer = await importerForTarget(workspaceRoot, target);
    if (importer) spec = { argv: ["pnpm", "--dir", importer, "dev"] };
  }
  if (!spec) {
    console.error(`run.${parsed.mode} is not available for ${target}`);
    process.exit(2);
  }
  const exitCode = await runCommand(spec.argv, parsed.passthrough, spec.cwd);
  process.exit(exitCode);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});
