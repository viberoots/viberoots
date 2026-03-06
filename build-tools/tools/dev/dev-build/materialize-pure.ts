import * as fsp from "node:fs/promises";
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const.ts";
import {
  formatRunnableLine,
  inferRunnableFromOutPath,
  parseRunnableManifest,
} from "../../lib/runnables.ts";

function materializeTimeoutSec(defaultSec: number): number {
  const raw = String(process.env.BNX_MATERIALIZE_TIMEOUT_SEC || "").trim();
  const parsed = Number(raw || String(defaultSec));
  if (!Number.isFinite(parsed) || parsed <= 0) return defaultSec;
  return Math.floor(parsed);
}

async function nixBuildPrintOutPaths(opts: {
  root: string;
  env: Record<string, string>;
  args: string;
  label: string;
  timeoutSec?: number;
}): Promise<string> {
  const tout = materializeTimeoutSec(opts.timeoutSec ?? 120);
  const res = await $({
    stdio: "pipe",
    cwd: opts.root,
    env: opts.env,
    nothrow: true,
  })`bash --noprofile --norc -c ${`set -euo pipefail; if ! command -v timeout >/dev/null 2>&1; then echo "dev-build materialize: timeout not found on PATH" 1>&2; exit 127; fi; timeout -k 5s ${tout}s nix build ${opts.args}`}`;
  if (res.exitCode === 0) {
    return String(res.stdout || "");
  }
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

function isLikelyBuckTarget(tok: string): boolean {
  if (!tok) return false;
  if (tok.includes("...")) return false;
  return tok.startsWith("//") || tok.includes(":");
}

function extractSpecificTargets(tokens: string[]): string[] {
  const specific: string[] = [];
  let skipNext = false;
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i] || "";
    if (skipNext) {
      skipNext = false;
      continue;
    }
    if (tok === "--") break;
    if (tok === "--target-platforms" || tok === "--user-platform" || tok.startsWith("-")) {
      if (tok === "--target-platforms" || tok === "--user-platform") skipNext = true;
      continue;
    }
    if (isLikelyBuckTarget(tok)) specific.push(tok);
  }
  return specific;
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

async function printManifestRunnables(linkName: string): Promise<void> {
  try {
    const manifestPath = path.resolve(linkName, "manifest.json");
    const txt = await fsp.readFile(manifestPath, "utf8").catch(() => "");
    if (!txt) return;
    const entries = parseRunnableManifest(txt);
    const runnables = entries.filter((e) => !!e.runnable);
    if (runnables.length) {
      console.log("Runnable targets:");
      for (const e of runnables) console.log(` - ${formatRunnableLine(e)}`);
      return;
    }

    const labels = entries.map((e) => String(e?.label || "")).filter(Boolean);
    if (labels.length) {
      console.log("Materialized graph; no runnable targets in manifest. Available labels:");
      for (const l of labels) console.log(` - ${l}`);
      console.log("See", manifestPath);
      return;
    }
    console.log("Materialized graph; no runnable targets found in manifest. See", manifestPath);
  } catch {}
}

export async function materializePureGraphIfEnabled(opts: {
  isCI: boolean;
  root: string;
  materialize: boolean;
  impure: boolean;
  restArgs: string[];
}): Promise<void> {
  if (opts.isCI || !opts.materialize || opts.impure) return;

  const linkDir = path.resolve(opts.root, "buck-out", "tmp");
  await fsp.mkdir(linkDir, { recursive: true });
  const linkName = path.join(linkDir, `buck-go-${Date.now()}`);

  const envPure = {
    ...process.env,
    BUCK_GRAPH_JSON: path.join(opts.root, DEFAULT_GRAPH_PATH),
  } as any;

  const specific = extractSpecificTargets(opts.restArgs || []);
  if (specific.length > 0) {
    console.log("Materializing selected targets (pure):");
    for (const sel of specific) {
      try {
        const envSel = {
          ...process.env,
          BUCK_TARGET: sel,
          BUCK_GRAPH_JSON: path.join(opts.root, DEFAULT_GRAPH_PATH),
        } as any;
        const selOut = await nixBuildPrintOutPaths({
          root: opts.root,
          env: envSel as Record<string, string>,
          args: "--no-write-lock-file .#graph-generator-pure-selected --accept-flake-config --no-link --print-out-paths",
          label: `materialize selected target ${sel}`,
          timeoutSec: 120,
        });
        const outPath =
          String(selOut || "")
            .trim()
            .split("\n")
            .filter(Boolean)
            .pop() || "";
        if (!outPath) {
          console.log(` - ${sel}: (no out path)`);
          continue;
        }
        const runnable = await inferRunnableFromOutPath({ label: sel, outPath });
        if (runnable) {
          console.log(` - ${sel}: ${runnable.kind}`);
        } else {
          const bins = await listBinArtifacts(outPath);
          if (bins.length) for (const b of bins) console.log(` - ${sel}: ${b}`);
          else console.log(` - ${sel}: (not runnable; inspect ${outPath})`);
        }
      } catch (e) {
        console.log(` - ${sel}: (failed to materialize)`);
        throw e;
      }
    }
    return;
  }

  const envFull = {
    ...process.env,
    BUCK_GRAPH_JSON: path.join(opts.root, DEFAULT_GRAPH_PATH),
  } as any;
  const pureOut = await nixBuildPrintOutPaths({
    root: opts.root,
    env: envFull as Record<string, string>,
    args: "--impure --no-write-lock-file .#graph-generator-pure --accept-flake-config --no-link --print-out-paths",
    label: "materialize full pure graph",
    timeoutSec: 420,
  });
  const purePath =
    String(pureOut || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .pop() || "";
  if (!purePath) {
    console.warn(
      "[dev-build] WARNING: pure graph evaluation returned no out path. If your manifest is empty, ensure buck graph export succeeded and glue exists (third_party/providers/auto_map.bzl, TARGETS.auto).",
    );
  } else {
    await $({ stdio: "inherit", cwd: opts.root })`ln -sfn ${purePath} ${linkName}`;
    await $({
      stdio: "pipe",
      cwd: opts.root,
    })`ln -sfn ${purePath} ${path.join(linkDir, "runnable-manifest-current")}`;
  }
  await printManifestRunnables(linkName);
}
