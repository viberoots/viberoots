import * as fsp from "node:fs/promises";
import path from "node:path";
import "zx/globals";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const.ts";
import { inferRunnableFromOutPath } from "../../lib/runnables.ts";
import { nodeBin, zxNodeBase } from "./paths.ts";

function materializeTimeoutSec(): number {
  const raw = String(process.env.BNX_MATERIALIZE_TIMEOUT_SEC || "").trim();
  const parsed = Number(raw || "120");
  if (!Number.isFinite(parsed) || parsed <= 0) return 120;
  return Math.floor(parsed);
}

async function nixBuildPrintOutPaths(opts: {
  root: string;
  env: Record<string, string>;
  args: string;
  label: string;
}): Promise<string> {
  const tout = materializeTimeoutSec();
  const res = await $({
    stdio: "pipe",
    cwd: opts.root,
    env: opts.env,
    nothrow: true,
  })`bash --noprofile --norc -c ${`set -euo pipefail; if ! command -v timeout >/dev/null 2>&1; then echo "dev-build materialize: timeout not found on PATH" 1>&2; exit 127; fi; timeout -k 5s ${tout}s nix build ${opts.args}`}`;
  if (res.exitCode === 0) return String(res.stdout || "");
  const stderr = String(res.stderr || "").trim();
  if (res.exitCode === 124) {
    throw new Error(
      `[dev-build] ${opts.label} timed out after ${tout}s while running: nix build ${opts.args}\n${stderr}`,
    );
  }
  throw new Error(
    `[dev-build] ${opts.label} failed (exit ${res.exitCode}) while running: nix build ${opts.args}\n${stderr}`,
  );
}

async function listBinArtifacts(outPath: string): Promise<string[]> {
  try {
    const binDir = path.join(outPath, "bin");
    const files = await fsp.readdir(binDir).catch(() => [] as string[]);
    return files.map((f) => path.join(binDir, f));
  } catch {
    return [];
  }
}

type GraphNode = { name?: unknown; labels?: unknown };

function extractRunnablesFromGraph(raw: unknown): Array<{ label: string; kind: string }> {
  const nodes = Array.isArray(raw)
    ? (raw as GraphNode[])
    : Array.isArray((raw as any)?.nodes)
      ? ((raw as any).nodes as GraphNode[])
      : [];
  const byLabel = new Map<string, string>();
  for (const n of nodes) {
    const label = String(n?.name || "").trim();
    if (!label) continue;
    const labels = Array.isArray(n?.labels)
      ? n.labels.map((x) => String(x || "")).filter(Boolean)
      : [];
    if (labels.includes("kind:app")) byLabel.set(label, "app");
    else if (labels.includes("kind:bin")) byLabel.set(label, "bin");
  }
  return Array.from(byLabel.entries())
    .map(([label, kind]) => ({ label, kind }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

export async function exportGraphImpure(root: string): Promise<void> {
  const node = nodeBin();
  const base = zxNodeBase(root);
  const runEnvImp = {
    ...process.env,
    ...(String(process.env.DEVBUILD_DEBUG || "").trim() === "1" ? { EXPORTER_DEBUG: "1" } : {}),
  } as any;
  await $({
    stdio: "inherit",
    cwd: root,
    env: runEnvImp,
  })`bash --noprofile --norc -c ${`${node} ${base} ${path.join(
    root,
    "build-tools/tools/buck/export-graph.ts",
  )} --out ${path.join(root, DEFAULT_GRAPH_PATH)}`}`;
}

export async function maybePrintImpureMaterializedBins(opts: {
  root: string;
  impure: boolean;
  subcmd: string;
  restArgs: string[];
}): Promise<void> {
  if (!opts.impure) return;
  if (opts.subcmd === "test") return;

  const targets = opts.restArgs.length ? opts.restArgs : [];
  const specific = targets.filter(
    (t) => (t.includes(":") || t.startsWith("//")) && !t.includes("..."),
  );
  const graphPath = path.join(opts.root, DEFAULT_GRAPH_PATH);

  if (specific.length > 0) {
    console.log("Impure selected targets:");
    for (const sel of specific) {
      try {
        const stdout = await nixBuildPrintOutPaths({
          root: opts.root,
          env: {
            ...process.env,
            BUCK_TEST_SRC: opts.root,
            BUCK_GRAPH_JSON: graphPath,
            BUCK_TARGET: sel,
          } as Record<string, string>,
          args: "--impure .#graph-generator-selected --accept-flake-config --print-out-paths",
          label: `impure materialize selected target ${sel}`,
        });
        const outPath =
          String(stdout || "")
            .trim()
            .split("\n")
            .filter(Boolean)
            .pop() || "";
        if (!outPath) {
          console.log(` - ${sel}: (no out path)`);
          continue;
        }
        const runnable = await inferRunnableFromOutPath({ label: sel, outPath });
        if (runnable) console.log(` - ${sel}: ${runnable.kind}`);
        else {
          const bins = await listBinArtifacts(outPath);
          if (bins.length) for (const b of bins) console.log(` - ${sel}: ${b}`);
          else console.log(` - ${sel}: (not runnable; inspect ${outPath})`);
        }
      } catch (e) {
        console.log(` - ${sel}: (failed to materialize impure selected)`);
        throw e;
      }
    }
    return;
  }

  // Broad/non-specific impure builds should still list runnable targets, but
  // without triggering a full graph-generator nix build just for reporting.
  try {
    const graphTxt = await fsp.readFile(graphPath, "utf8");
    const runnables = extractRunnablesFromGraph(JSON.parse(graphTxt));
    if (runnables.length > 0) {
      console.log("Impure runnable targets (from exported graph labels):");
      for (const r of runnables) console.log(` - ${r.label} [${r.kind}]`);
      return;
    }
    console.log("Impure build: no runnable targets found in exported graph labels.");
  } catch {
    console.log(`Impure build: could not read exported graph for runnable listing (${graphPath}).`);
  }
  return;
}
