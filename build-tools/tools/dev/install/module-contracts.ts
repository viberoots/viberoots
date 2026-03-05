import * as fsp from "node:fs/promises";
import path from "node:path";
import { runNodeWithZx } from "../../lib/node-run.ts";

type ModuleContractsPaths = {
  wasmManifestPath: string;
  tsManifestPath: string;
};

async function fileExists(absPath: string): Promise<boolean> {
  try {
    await fsp.access(absPath);
    return true;
  } catch {
    return false;
  }
}

async function isNodeWebappImporter(repoRoot: string, importer: string): Promise<boolean> {
  const targetsPath = path.join(repoRoot, importer, "TARGETS");
  try {
    const text = await fsp.readFile(targetsPath, "utf8");
    return /node_webapp\s*\(/.test(text);
  } catch {
    return false;
  }
}

async function listNodeAssetStageTargets(repoRoot: string, importer: string): Promise<string[]> {
  const targetsPath = path.join(repoRoot, importer, "TARGETS");
  try {
    const text = await fsp.readFile(targetsPath, "utf8");
    const names: string[] = [];
    const callRegex = /node_asset_stage\s*\(([\s\S]*?)\)\s*/g;
    let callMatch: RegExpExecArray | null = null;
    while ((callMatch = callRegex.exec(text)) !== null) {
      const body = callMatch[1] || "";
      const nameMatch = body.match(/name\s*=\s*"([^"]+)"/);
      if (!nameMatch?.[1]) continue;
      names.push(nameMatch[1]);
    }
    return names;
  } catch {
    return [];
  }
}

async function expectsModuleContracts(importerAbs: string): Promise<boolean> {
  for (const rel of [
    "src/wasm-contract.ts",
    "src/ts-modules.ts",
    "app/wasm-contract.ts",
    "app/ts-modules.ts",
  ]) {
    if (await fileExists(path.join(importerAbs, rel))) return true;
  }
  return false;
}

function parsePathsJson(stdout: string): ModuleContractsPaths | null {
  const lines = String(stdout || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const raw = lines[i] || "";
    try {
      const parsed = JSON.parse(raw) as ModuleContractsPaths;
      if (parsed?.wasmManifestPath && parsed?.tsManifestPath) return parsed;
    } catch {}
  }
  return null;
}

export async function syncModuleContractsForWebapps(
  repoRoot: string,
  importers: string[],
  dryRun: boolean,
  verbose: boolean,
): Promise<void> {
  const script = path.join(repoRoot, "build-tools", "tools", "dev", "sync-module-contracts.ts");
  const zxInitPath = path.join(repoRoot, "build-tools", "tools", "dev", "zx-init.mjs");
  if (!(await fileExists(script)) || !(await fileExists(zxInitPath))) return;
  for (const importer of importers) {
    if (!(await isNodeWebappImporter(repoRoot, importer))) continue;
    const importerAbs = path.join(repoRoot, importer);
    const requiresContracts = await expectsModuleContracts(importerAbs);
    if (dryRun) {
      if (verbose) {
        console.log(`[module-contracts] dry-run: skip sync+mirror for ${importer}`);
      }
      continue;
    }
    try {
      const nodeAssetStageTargets = await listNodeAssetStageTargets(repoRoot, importer);
      const targetCandidates = nodeAssetStageTargets.length > 0 ? nodeAssetStageTargets : [""];
      let resolvedPaths: ModuleContractsPaths | null = null;
      let lastErr = "";
      for (const targetName of targetCandidates) {
        try {
          const args = ["--cwd", importerAbs] as string[];
          if (targetName) {
            args.push("--app-target", `//${importer}:${targetName}`);
          }
          args.push("--print-json", "1");
          const out = await runNodeWithZx({
            cwd: repoRoot,
            script,
            args,
            zxInitPath,
            stdio: "pipe",
            timeoutMs: 120000,
          });
          const paths = parsePathsJson(out.stdout);
          if (!paths) {
            throw new Error(`invalid sync output for ${importer}`);
          }
          resolvedPaths = paths;
          break;
        } catch (candidateErr) {
          const errObj = candidateErr as { message?: string; stderr?: string };
          const msg =
            candidateErr instanceof Error
              ? candidateErr.message
              : errObj?.message || String(candidateErr);
          const stderr = String(errObj?.stderr || "").trim();
          lastErr = stderr ? `${msg}; stderr=${stderr}` : msg;
        }
      }
      if (!resolvedPaths) {
        throw new Error(lastErr || `module-contract sync failed for ${importer}`);
      }
      if (verbose) {
        console.log(`[module-contracts] sync:ok importer=${importer}`);
      }
    } catch (e) {
      if (!requiresContracts) {
        if (verbose) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log(`[module-contracts] sync:skip importer=${importer} reason=${msg}`);
        }
        continue;
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`[module-contracts] sync failed for ${importer}: ${msg}`);
    }
  }
}
