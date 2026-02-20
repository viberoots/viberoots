import * as fsp from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const.ts";
import { readCompositeGraph } from "../../lib/graph-view.ts";
import { runGomod2nixGenerate, runGomod2nixScanAll } from "../install/gomod2nix.ts";
import { nodeBin, zxNodeBase } from "./paths.ts";

export async function cleanDevBuildWorkspace(root: string): Promise<void> {
  await $({
    stdio: "ignore",
    cwd: root,
  })`bash --noprofile --norc -c 'rm -rf buck-go-*'`.nothrow();

  await $({
    stdio: "ignore",
    cwd: root,
  })`bash --noprofile --norc -c 'rm -rf .tmp'`.nothrow();
}

async function debugListTargets(root: string): Promise<void> {
  if ((process.env.DEVBUILD_DEBUG || "").trim() !== "1") return;
  try {
    console.warn("[dev-build][debug] listing TARGETS files before export:");
    await $({
      stdio: "inherit",
      cwd: root,
    })`bash --noprofile --norc -c 'find . -name TARGETS -type f | sort | sed -e s,^.,ROOT,'`;
    const demoTargets = path.join(root, "libs", "demo-lib", "TARGETS");
    try {
      const txt = await fsp.readFile(demoTargets, "utf8").catch(() => "");
      if (txt) console.warn("[dev-build][debug] projects/libs/demo-lib/TARGETS contents:\n" + txt);
    } catch {}
    console.warn("[dev-build][debug] running 'buck2 targets //...'");
    await $({ stdio: "inherit", cwd: root })`buck2 targets //...`;
  } catch {}
}

async function exportGraph(root: string, opts: { scope?: string; env: Record<string, string> }) {
  const node = nodeBin();
  const nodeBase = zxNodeBase(root);
  const graphPath = path.join(root, DEFAULT_GRAPH_PATH);
  const scope = (opts.scope || "").trim();
  const cmd = `${node} ${nodeBase} ${path.join(root, "build-tools/tools/buck/export-graph.ts")}${
    scope ? ` --scope ${scope}` : ""
  } --out ${graphPath}`;
  await $({
    stdio: "inherit",
    cwd: root,
    env: opts.env as any,
  })`bash --noprofile --norc -c ${cmd}`;
  return graphPath;
}

function stableExporterIsolation(root: string): string {
  const key = path.resolve(root);
  const h = crypto.createHash("sha256").update(key).digest("hex").slice(0, 10);
  return `exporter-shared-${h}`;
}

async function ensureNonEmptyGraphOrExit(root: string, graphPath: string): Promise<void> {
  const comp = await readCompositeGraph({ graphPath: path.resolve(root, DEFAULT_GRAPH_PATH) });
  const graphLen = Array.isArray(comp?.nodes) ? comp.nodes.length : 0;
  if (Number.isFinite(graphLen) && graphLen > 0) return;

  if ((process.env.DEVBUILD_TRIED_FALLBACK || "") !== "1") {
    try {
      console.warn(
        "[dev-build] graph empty; retrying export with --scope lang:go for bootstrap scenarios",
      );
      process.env.DEVBUILD_TRIED_FALLBACK = "1";
      const runEnv = {
        ...process.env,
        BUCK_NESTED_ISO: stableExporterIsolation(root),
        BUCK_EXPORTER_REUSE_DAEMON: "1",
        ...(String(process.env.DEVBUILD_DEBUG || "").trim() === "1" ? { EXPORTER_DEBUG: "1" } : {}),
      } as any;
      await exportGraph(root, { scope: "lang:go", env: runEnv });
      const comp2 = await readCompositeGraph({ graphPath: path.resolve(root, DEFAULT_GRAPH_PATH) });
      const graphLen2 = Array.isArray(comp2?.nodes) ? comp2.nodes.length : 0;
      if (Number.isFinite(graphLen2) && graphLen2 > 0) {
        console.warn("[dev-build] export succeeded with scoped lang:go");
        return;
      }

      try {
        console.warn("[dev-build] bootstrap: warming up buck targets and re-exporting");
        try {
          await $({ stdio: "inherit", cwd: root })`buck2 targets //...`;
        } catch {}
        const runEnvNoIso = { ...runEnv, BUCK_NO_ISOLATION: "1", EXPORTER_DEBUG: "1" } as any;
        await exportGraph(root, { env: runEnvNoIso });
        const comp3 = await readCompositeGraph({
          graphPath: path.resolve(root, DEFAULT_GRAPH_PATH),
        });
        const graphLen3 = Array.isArray(comp3?.nodes) ? comp3.nodes.length : 0;
        if (Number.isFinite(graphLen3) && graphLen3 > 0) {
          console.warn("[dev-build] export succeeded after bootstrap warmup");
          return;
        }
        console.error(
          "[dev-build] ERROR: build-tools/tools/buck/graph.json is empty even after bootstrap; export failed or found no nodes.",
        );
        process.exit(2);
      } catch (e3) {
        console.error("[dev-build] ERROR: bootstrap export failed:", e3);
        process.exit(2);
      }
    } catch (e) {
      console.error("[dev-build] ERROR: export-graph retry with --scope lang:go failed:", e);
      process.exit(2);
    }
  }

  console.error(
    "[dev-build] ERROR: build-tools/tools/buck/graph.json is empty. Export failed or found no nodes.",
  );
  process.exit(2);
}

export async function refreshGlueAndExportGraph(root: string): Promise<string> {
  const node = nodeBin();
  const nodeBase = zxNodeBase(root);
  await $({
    stdio: "inherit",
    cwd: root,
  })`bash --noprofile --norc -c ${`${node} ${nodeBase} ${path.join(
    root,
    "build-tools/tools/dev/install-deps.ts",
  )} --glue-only`}`;

  try {
    await runGomod2nixGenerate(false, false);
    await runGomod2nixScanAll(false, false);
  } catch (e) {
    console.warn("[dev-build] gomod2nix generation skipped:", e);
  }

  await debugListTargets(root);

  const runEnv = {
    ...process.env,
    BUCK_NESTED_ISO: stableExporterIsolation(root),
    BUCK_EXPORTER_REUSE_DAEMON: "1",
    ...(String(process.env.DEVBUILD_DEBUG || "").trim() === "1" ? { EXPORTER_DEBUG: "1" } : {}),
  } as any;

  const scope = (process.env.DEVBUILD_SCOPE || "").trim();
  const graphPath = await exportGraph(root, { scope, env: runEnv });
  await ensureNonEmptyGraphOrExit(root, graphPath);

  process.env.BUCK_GRAPH_JSON = graphPath;
  return graphPath;
}
