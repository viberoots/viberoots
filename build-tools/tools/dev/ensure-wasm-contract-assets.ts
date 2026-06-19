#!/usr/bin/env zx-wrapper
import * as fsp from "node:fs/promises";
import path from "node:path";
import { getFlagStr } from "../lib/cli";
import { runManagedCommand } from "../lib/managed-command";
import { specsFromWasmManifest } from "./wasm-watch-manifest";

async function exists(absPath: string): Promise<boolean> {
  try {
    await fsp.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function runBuildStep(buildCommand: string, cwd: string): Promise<void> {
  const shell = String(process.env.BASH || "bash").trim() || "bash";
  const result = await runManagedCommand({
    command: shell,
    args: ["--noprofile", "--norc", "-lc", buildCommand],
    cwd,
    env: process.env,
    timeoutMs: 10 * 60 * 1000,
  });
  if (result.ok) return;
  const stderrTail = String(result.stderr || "").slice(-4000);
  const stdoutTail = String(result.stdout || "").slice(-2000);
  throw new Error(
    [
      `build command failed (code=${String(result.code)} signal=${String(result.signal)})`,
      stderrTail ? `stderr tail:\n${stderrTail}` : "",
      stdoutTail ? `stdout tail:\n${stdoutTail}` : "",
    ]
      .filter(Boolean)
      .join("\n\n"),
  );
}

async function main() {
  const cwd = path.resolve(getFlagStr("cwd", process.cwd()) || process.cwd());
  const wasmManifestPath = String(getFlagStr("wasm-manifest", "") || "").trim();
  if (!wasmManifestPath) throw new Error("missing required flag --wasm-manifest");

  const specs = await specsFromWasmManifest(cwd, wasmManifestPath);
  for (const spec of specs) {
    const outputs = [spec.syncOut, ...(spec.extraSyncOuts || [])];
    const existing = await Promise.all(outputs.map(async (abs) => await exists(abs)));
    if (existing.every(Boolean)) continue;
    await runBuildStep(spec.buildCommand, cwd);
    for (const out of outputs) {
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await fsp.copyFile(spec.buildOut, out);
    }
    console.error(
      `[wasm-assets] materialized module_key=${spec.moduleKey} out=${outputs.map((out) => path.relative(cwd, out)).join(",")}`,
    );
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack || err.message : String(err));
  process.exit(1);
});
