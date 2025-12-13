import * as fsp from "node:fs/promises";
import path from "node:path";
import "zx/globals";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const.ts";

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

async function printManifestBins(linkName: string): Promise<void> {
  try {
    const manifestPath = path.resolve(linkName, "manifest.json");
    const txt = await fsp.readFile(manifestPath, "utf8").catch(() => "");
    if (!txt) return;
    const entries = JSON.parse(txt) as Array<any>;
    const bins: Array<{ label: string; bin: string }> = [];
    for (const e of entries) {
      const lab = String(e?.label || "");
      if (!lab) continue;
      const list: string[] = Array.isArray(e?.bins) ? e.bins : [];
      for (const b of list) bins.push({ label: lab, bin: String(b) });
    }
    if (bins.length) {
      console.log("Materialized binaries:");
      for (const b of bins) console.log(` - ${b.label}: ${b.bin}`);
      return;
    }

    const labels = entries.map((e: any) => String(e?.label || "")).filter(Boolean);
    if (labels.length) {
      console.log("Materialized graph; no bins produced. Available labels:");
      for (const l of labels) console.log(` - ${l}`);
      console.log("See", manifestPath);
      return;
    }
    console.log("Materialized graph; no bins found in manifest. See", manifestPath);
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

  const { stdout: graphOut } = await $({
    stdio: "pipe",
    cwd: opts.root,
    env: envPure,
  })`nix build --impure --no-write-lock-file .#buck-graph --no-link --accept-flake-config --print-out-paths`;
  const graphStore = String(graphOut || "")
    .trim()
    .split("\n")
    .filter(Boolean)
    .pop();
  if (!graphStore) throw new Error("failed to build .#buck-graph");

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
        const { stdout: selOut } = await $({
          stdio: "pipe",
          cwd: opts.root,
          env: envSel,
        })`nix build --no-write-lock-file .#graph-generator-pure-selected --accept-flake-config --print-out-paths`;
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
        const bins = await listBinArtifacts(outPath);
        if (bins.length) {
          for (const b of bins) console.log(` - ${sel}: ${b}`);
        } else {
          console.log(` - ${sel}: (no bin artifacts in ${path.join(outPath, "bin")})`);
        }
      } catch (e) {
        console.log(` - ${sel}: (failed to materialize)`, e);
      }
    }
    return;
  }

  const envFull = {
    ...process.env,
    BUCK_GRAPH_JSON: path.join(opts.root, DEFAULT_GRAPH_PATH),
  } as any;
  const { stdout: pureOut } = await $({
    stdio: "pipe",
    cwd: opts.root,
    env: envFull,
  })`nix build --impure --no-write-lock-file .#graph-generator-pure --accept-flake-config --print-out-paths`;
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
  }
  await printManifestBins(linkName);
}
