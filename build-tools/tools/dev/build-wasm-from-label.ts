#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli";
import { findRepoRoot } from "../lib/repo";
import { runManagedCommand } from "../lib/managed-command";
import { runNodeWithZx } from "../lib/node-run";
import { sanitizeName } from "../lib/sanitize";
import { DEFAULT_GRAPH_PATH } from "../lib/workspace-state-paths";

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function mkdirIfMissing(abs: string): Promise<void> {
  await fsp.mkdir(abs, { recursive: true });
}

async function withLock(lockDir: string, fn: () => Promise<void>): Promise<void> {
  for (;;) {
    try {
      await fsp.mkdir(lockDir);
      break;
    } catch {
      await sleep(100);
    }
  }
  try {
    await fn();
  } finally {
    await fsp.rm(lockDir, { recursive: true, force: true });
  }
}

function parseBuckShowOutput(stdout: string, label: string): string {
  const normalized = label.startsWith("//") ? `root${label}` : label;
  const lines = String(stdout || "")
    .trim()
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const hit = lines.find(
    (line) => line.startsWith(label + " ") || line.startsWith(normalized + " "),
  );
  if (!hit) throw new Error(`failed to parse buck2 --show-output for '${label}'`);
  const rel = hit.slice(label.length).trim().split(/\s+/).pop() || "";
  if (!rel) throw new Error(`missing output path for '${label}'`);
  return rel;
}

async function refreshGraphForTarget(root: string, label: string): Promise<void> {
  const graphPath = path.join(root, DEFAULT_GRAPH_PATH);
  const exportScript = path.join(root, "build-tools", "tools", "buck", "export-graph.ts");
  const zxInit = path.join(root, "build-tools", "tools", "dev", "zx-init.mjs");
  try {
    await runNodeWithZx({
      nodeBin: process.execPath,
      zxInitPath: zxInit,
      script: exportScript,
      args: ["--out", graphPath],
      cwd: root,
      env: {
        ...process.env,
        WORKSPACE_ROOT: root,
        BUCK_TEST_SRC: root,
        BUCK_TARGET: label,
        BUCK_GRAPH_JSON: graphPath,
        REPO_ROOT: root,
      },
      stdio: "pipe",
      timeoutMs: 2 * 60 * 1000,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`failed to refresh buck graph before wasm label build '${label}': ${message}`);
  }
}

async function main() {
  const label = String(getFlagStr("label", "") || "").trim();
  const out = String(getFlagStr("out", "") || "").trim();
  if (!label || !out)
    throw new Error("usage: build-wasm-from-label --label <buck-label> --out <path>");
  const root = await findRepoRoot(process.cwd());
  const outAbs = path.resolve(process.cwd(), out);
  const cacheDir = path.join(root, "buck-out", "tmp", "wasm-shared", sanitizeName(label));
  const lockDir = `${cacheDir}.lock`;
  await mkdirIfMissing(path.dirname(outAbs));
  await mkdirIfMissing(cacheDir);
  const cacheWasm = path.join(cacheDir, "artifact.wasm");

  await withLock(lockDir, async () => {
    await refreshGraphForTarget(root, label);
    const res = await runManagedCommand({
      command: "buck2",
      args: ["build", "--target-platforms", "prelude//platforms:default", "--show-output", label],
      cwd: root,
      env: process.env,
      timeoutMs: 10 * 60 * 1000,
    });
    if (!res.ok) {
      const stderrTail = String(res.stderr || "").slice(-4000);
      const stdoutTail = String(res.stdout || "").slice(-2000);
      throw new Error(
        [
          `buck2 build failed for '${label}' (code=${String(res.code)} signal=${String(res.signal)})`,
          stderrTail ? `stderr tail:\n${stderrTail}` : "",
          stdoutTail ? `stdout tail:\n${stdoutTail}` : "",
        ]
          .filter(Boolean)
          .join("\n\n"),
      );
    }
    const relOut = parseBuckShowOutput(String(res.stdout || ""), label);
    const builtAbs = path.resolve(root, relOut);
    await fsp.rm(cacheWasm, { force: true });
    await fsp.copyFile(builtAbs, cacheWasm);
  });

  await fsp.rm(outAbs, { force: true });
  await fsp.copyFile(cacheWasm, outAbs);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
