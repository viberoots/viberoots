import * as fsp from "node:fs/promises";
import path from "node:path";
import "zx/globals";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const.ts";
import {
  formatRunnableLine,
  inferRunnableFromOutPath,
  parseRunnableManifest,
} from "../../lib/runnables.ts";
import { nodeBin, zxNodeBase } from "./paths.ts";

async function listBinArtifacts(outPath: string): Promise<string[]> {
  try {
    const binDir = path.join(outPath, "bin");
    const files = await fsp.readdir(binDir).catch(() => [] as string[]);
    return files.map((f) => path.join(binDir, f));
  } catch {
    return [];
  }
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
        const { stdout } = await $({
          stdio: "pipe",
          cwd: opts.root,
          env: {
            ...process.env,
            BUCK_TEST_SRC: opts.root,
            BUCK_GRAPH_JSON: graphPath,
            BUCK_TARGET: sel,
          } as any,
        })`nix build --impure .#graph-generator-selected --accept-flake-config --print-out-paths`;
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
        console.log(` - ${sel}: (failed to materialize impure selected)`, e);
      }
    }
    return;
  }

  try {
    const env = {
      ...process.env,
      BUCK_TEST_SRC: opts.root,
      BUCK_GRAPH_JSON: graphPath,
    } as any;
    const { stdout } = await $({
      stdio: "pipe",
      cwd: opts.root,
      env,
    })`nix build --impure --no-write-lock-file .#graph-generator --accept-flake-config --no-link --print-out-paths`;
    const outPath =
      String(stdout || "")
        .trim()
        .split("\n")
        .filter(Boolean)
        .pop() || "";
    if (outPath) {
      const linkDir = path.join(opts.root, "buck-out", "tmp");
      await fsp.mkdir(linkDir, { recursive: true });
      await $({
        cwd: opts.root,
        stdio: "pipe",
      })`ln -sfn ${outPath} ${path.join(linkDir, "runnable-manifest-current")}`;
    }
    const manifestPath = path.resolve(outPath, "manifest.json");
    const txt = await fsp.readFile(manifestPath, "utf8").catch(() => "");
    if (!txt) return;
    const entries = parseRunnableManifest(txt);
    const runnables = entries.filter((e) => !!e.runnable);
    if (runnables.length) {
      console.log("Impure runnable targets:");
      for (const e of runnables) console.log(` - ${formatRunnableLine(e)}`);
      return;
    }
    const labels = entries.map((e) => String(e?.label || "")).filter(Boolean);
    if (labels.length) {
      console.log("Impure materialized graph; no runnable targets in manifest. Available labels:");
      for (const l of labels) console.log(` - ${l}`);
      console.log("See", manifestPath);
      return;
    }
    console.log(
      "Impure materialized graph; no runnable targets found in manifest. See",
      manifestPath,
    );
  } catch {}
}
