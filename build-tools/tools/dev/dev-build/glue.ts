import * as fsp from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { DEFAULT_GRAPH_PATH } from "../../lib/graph-const";
import { readCompositeGraph } from "../../lib/graph-view";
import { isVbrVerbose } from "../../lib/command-ui";
import { buildToolPath, nodeBin, zxNodeBase } from "./paths";
import { runGluePipeline } from "../../buck/glue-pipeline";

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
    await $({ stdio: "inherit", cwd: root, env: buckProcessEnv() })`buck2 targets //...`;
  } catch {}
}

async function exportGraph(root: string, opts: { scope?: string; env: NodeJS.ProcessEnv }) {
  const node = nodeBin();
  const nodeBase = zxNodeBase(root);
  const graphPath = path.join(root, DEFAULT_GRAPH_PATH);
  const scope = (opts.scope || "").trim();
  const verbose = isVbrVerbose() || String(process.env.DEVBUILD_DEBUG || "").trim() === "1";
  const cmd = `${node} ${nodeBase} ${buildToolPath(root, "tools/buck/export-graph.ts")}${
    scope ? ` --scope ${scope}` : ""
  } --out ${graphPath}`;
  await $({
    stdio: verbose ? "inherit" : "pipe",
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

function buckProcessEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const sslCertFile = process.env.SSL_CERT_FILE || process.env.NIX_SSL_CERT_FILE || "";
  const quietBuck =
    !isVbrVerbose() &&
    String(process.env.DEVBUILD_DEBUG || "").trim() !== "1" &&
    !String(process.env.BUCK_VERBOSE || "").trim();
  return {
    ...process.env,
    ...(quietBuck ? { BUCK_VERBOSE: "0" } : {}),
    ...extra,
    HOME: process.env.BUCK2_REAL_HOME || process.env.HOME,
    ...(sslCertFile
      ? {
          SSL_CERT_FILE: sslCertFile,
          NIX_SSL_CERT_FILE: process.env.NIX_SSL_CERT_FILE || sslCertFile,
        }
      : {}),
  };
}

async function workspaceHasOnlyGeneratedTargets(root: string): Promise<boolean> {
  const res = await $({
    stdio: "pipe",
    cwd: root,
    env: buckProcessEnv(),
    nothrow: true,
  })`buck2 -v 0 targets --console none //...`;
  if (res.exitCode !== 0) return false;
  const targets = String(res.stdout || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes("//"));
  return (
    targets.length > 0 &&
    targets.every(
      (target) =>
        target.includes("//.viberoots/") ||
        target.includes("//prelude/") ||
        target.includes("//toolchains/"),
    )
  );
}

async function ensureNonEmptyGraphOrExit(root: string, graphPath: string): Promise<void> {
  const comp = await readCompositeGraph({ graphPath: path.resolve(root, DEFAULT_GRAPH_PATH) });
  const graphLen = Array.isArray(comp?.nodes) ? comp.nodes.length : 0;
  if (Number.isFinite(graphLen) && graphLen > 0) return;

  if (await workspaceHasOnlyGeneratedTargets(root)) {
    if (isVbrVerbose() || String(process.env.DEVBUILD_DEBUG || "").trim() === "1") {
      console.warn(
        "[dev-build] graph empty because workspace has only generated bootstrap targets",
      );
    }
    process.env.DEVBUILD_EMPTY_GRAPH = "1";
    return;
  }

  if ((process.env.DEVBUILD_TRIED_FALLBACK || "") !== "1") {
    try {
      console.warn(
        "[dev-build] graph empty; retrying export with --scope lang:go for bootstrap scenarios",
      );
      process.env.DEVBUILD_TRIED_FALLBACK = "1";
      const runEnv = buckProcessEnv({
        BUCK_NESTED_ISO: stableExporterIsolation(root),
        BUCK_EXPORTER_REUSE_DAEMON: "1",
        ...(String(process.env.DEVBUILD_DEBUG || "").trim() === "1" ? { EXPORTER_DEBUG: "1" } : {}),
      });
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
          await $({
            stdio: "pipe",
            cwd: root,
            env: buckProcessEnv(),
          })`buck2 -v 0 targets --console none //...`;
        } catch {}
        const runEnvNoIso = {
          ...runEnv,
          BUCK_NO_ISOLATION: "1",
          ...(String(process.env.DEVBUILD_DEBUG || "").trim() === "1"
            ? { EXPORTER_DEBUG: "1" }
            : {}),
        };
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
          "[dev-build] ERROR: .viberoots/workspace/buck/graph.json is empty even after bootstrap; export failed or found no nodes.",
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
    "[dev-build] ERROR: .viberoots/workspace/buck/graph.json is empty. Export failed or found no nodes.",
  );
  process.exit(2);
}

export async function refreshGlueAndExportGraph(root: string): Promise<string> {
  const node = nodeBin();
  const nodeBase = zxNodeBase(root);
  const verbose = isVbrVerbose() || String(process.env.DEVBUILD_DEBUG || "").trim() === "1";
  await $({
    stdio: verbose ? "inherit" : "pipe",
    cwd: root,
  })`bash --noprofile --norc -c ${`${node} ${nodeBase} ${buildToolPath(
    root,
    "tools/dev/install-deps.ts",
  )} --glue-only`}`;

  await debugListTargets(root);

  const runEnv = buckProcessEnv({
    BUCK_NESTED_ISO: stableExporterIsolation(root),
    BUCK_EXPORTER_REUSE_DAEMON: "1",
    ...(String(process.env.DEVBUILD_DEBUG || "").trim() === "1" ? { EXPORTER_DEBUG: "1" } : {}),
  });

  const scope = (process.env.DEVBUILD_SCOPE || "").trim();
  const graphPath = await exportGraph(root, { scope, env: runEnv });
  await ensureNonEmptyGraphOrExit(root, graphPath);
  await runGluePipeline({ graphPath, skipProviderSync: true });

  process.env.BUCK_GRAPH_JSON = graphPath;
  return graphPath;
}
