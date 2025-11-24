#!/usr/bin/env zx-wrapper
import { execFile } from "node:child_process";
import * as fsp from "node:fs/promises";
import path from "node:path";
import { findRepoRoot } from "../lib/repo.ts";
import { DEFAULT_GRAPH_PATH } from "../lib/graph-const.ts";
import { exportInlineGraph } from "../buck/export-inline.ts";

async function buck2Present(): Promise<boolean> {
  try {
    const res = await $({ stdio: "pipe" })`buck2 --version`.nothrow();
    return res.exitCode === 0;
  } catch {
    return false;
  }
}

async function runNode(nodeBin: string, zxInit: string, script: string, args: string[] = []) {
  const zxArgs = [
    "--experimental-top-level-await",
    "--disable-warning=ExperimentalWarning",
    "--experimental-strip-types",
    "--import",
    zxInit,
    script,
    ...args,
  ];
  await new Promise<void>((resolve, reject) => {
    execFile(nodeBin, zxArgs, { stdio: "inherit" }, (err) => (err ? reject(err) : resolve()));
  });
}

// ensureGraph: writes tools/buck/graph.json if missing by invoking the exporter
export async function ensureGraph(): Promise<void> {
  const workspaceRoot = (
    process.env.BUCK_TEST_SRC ||
    process.env.WORKSPACE_ROOT ||
    process.cwd()
  ).trim();
  const graphPath = path.join(workspaceRoot, "tools", "buck", "graph.json");
  const forceInline = String(process.env.EXPORTER_FORCE_INLINE || "").trim() === "1";
  async function isValidJsonFile(p: string): Promise<boolean> {
    try {
      const txt = await fsp.readFile(p, "utf8");
      const trimmed = String(txt || "").trim();
      if (!trimmed || trimmed === "[]") return false;
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  try {
    console.error(`[ensureGraph] workspaceRoot=${workspaceRoot}`);
  } catch {}
  try {
    const txt = await fsp.readFile(graphPath, "utf8");
    const trimmed = String(txt || "").trim();
    if (trimmed && trimmed !== "[]") {
      // If a specific target is requested, confirm it is present in the graph; otherwise regenerate.
      const want = String(process.env.BUCK_TARGET || "").trim();
      let hasWanted = false;
      if (want) {
        try {
          const data = JSON.parse(trimmed);
          const arr = Array.isArray(data)
            ? (data as any[])
            : Array.isArray((data as any).nodes)
              ? ((data as any).nodes as any[])
              : [];
          const normWant = (await import("../lib/labels.ts")).normalizeTargetLabel(want);
          for (const n of arr) {
            const nm = typeof n?.name === "string" ? n.name : "";
            if (nm && (await import("../lib/labels.ts")).then ? false : false) {
            }
          }
          // dynamic import above can't be awaited inline in loop in TS transpile; do separate import
        } catch {}
        try {
          const mod: any = await import("../lib/labels.ts");
          const normWant = mod.normalizeTargetLabel(want);
          const data = JSON.parse(trimmed);
          const nodes: any[] = Array.isArray(data)
            ? (data as any[])
            : Array.isArray((data as any).nodes)
              ? ((data as any).nodes as any[])
              : [];
          hasWanted = nodes.some(
            (n: any) =>
              typeof n?.name === "string" && mod.normalizeTargetLabel(n.name) === normWant,
          );
        } catch {
          hasWanted = false;
        }
      }
      if (want && !hasWanted) {
        try {
          console.error(`[ensureGraph] target ${want} missing in existing graph — regenerating`);
        } catch {}
        // fall through to regenerate
      } else {
        try {
          console.error(`[ensureGraph] graph exists and non-empty: ${graphPath}`);
        } catch {}
        return;
      }
    }
    // fall through to regenerate when file is empty or "[]"
  } catch {
    // missing or unreadable → regenerate
  }
  const nodeBin = process.execPath;
  const repoRoot =
    (process.env.REPO_ROOT && process.env.REPO_ROOT.trim()) || (await findRepoRoot(process.cwd()));
  const zxInit = path.join(repoRoot, "tools/dev/zx-init.mjs");
  const exportScript = path.join(repoRoot, "tools/buck/export-graph.ts");
  // Prefer direct Node exporter when buck2 is available; otherwise fallback to nix-run or inline query
  const haveBuck = await buck2Present();
  if (forceInline) {
    try {
      console.error(`[ensureGraph] inline export via buck2 → ${graphPath}`);
    } catch {}
    const rawRoots = (process.env.BUCK_QUERY_ROOTS || "apps,libs,go,cpp,third_party")
      .split(/[,\s]+/)
      .filter(Boolean);
    const fs = await import("node:fs");
    const existingRoots = rawRoots.filter((r) => {
      const dir = r.replace(/^\/+/, "");
      try {
        return fs.existsSync(path.join(workspaceRoot, dir));
      } catch {
        return false;
      }
    });
    const wantTargetRaw = (process.env.BUCK_TARGET || "").trim();
    await exportInlineGraph({
      workspaceRoot,
      outPath: graphPath,
      target: wantTargetRaw,
      roots: existingRoots.length > 0 ? existingRoots : ["libs"],
      includeTargetPlatforms: true,
      normalizeLabels: true,
    });
    return;
  }
  const exporterArgs = ["--out", graphPath];
  const passEnv = {
    ...process.env,
    WORKSPACE_ROOT: workspaceRoot,
    BUCK_TEST_SRC: workspaceRoot,
    REPO_ROOT: repoRoot,
  } as Record<string, string>;
  if (haveBuck) {
    try {
      await runNode(nodeBin, zxInit, exportScript, exporterArgs);
      // Validate JSON; if invalid, fall through to alternate exporters
      if (await isValidJsonFile(graphPath)) {
        return;
      }
    } catch {}
  }
  // Fallback: invoke via nix-run to mirror legacy behavior in temp/nix-driven environments
  try {
    await $({
      env: passEnv,
    })`nix run --accept-flake-config ${repoRoot}#zx-wrapper -- ${exportScript} ${exporterArgs}`;
    // Verify file now exists; throw if still missing
    await fsp.access(graphPath);
    if (await isValidJsonFile(graphPath)) {
      return;
    }
  } catch {
    // Final fallback: perform a minimal inline export using buck2 if available
    if (!(await buck2Present())) {
      throw new Error(
        "tools/buck/graph.json is missing and exporter failed. Ensure buck2 is available and try: nix run .#zx-wrapper -- tools/buck/export-graph.ts",
      );
    }
    try {
      console.error(`[ensureGraph] inline export via buck2 → ${graphPath}`);
    } catch {}
    const rawRoots = (process.env.BUCK_QUERY_ROOTS || "apps,libs,go,cpp,third_party")
      .split(/[,\s]+/)
      .filter(Boolean);
    const fs = await import("node:fs");
    const existingRoots = rawRoots.filter((r) => {
      const dir = r.replace(/^\/+/, "");
      try {
        return fs.existsSync(path.join(workspaceRoot, dir));
      } catch {
        return false;
      }
    });
    await exportInlineGraph({
      workspaceRoot,
      outPath: graphPath,
      target: "",
      roots: existingRoots.length > 0 ? existingRoots : ["libs"],
      includeTargetPlatforms: false,
      normalizeLabels: false,
    });
    return;
  }
}

// runGlue: sync providers (all languages) then generate auto_map deterministically
export async function runGlue(): Promise<void> {
  await ensureGraph();
  const nodeBin = process.execPath;
  const repoRoot = process.cwd();
  const zxInit = path.join(repoRoot, "tools/dev/zx-init.mjs");
  const syncScript = path.join(repoRoot, "tools/buck/sync-providers.ts");
  const providerIndexScript = path.join(repoRoot, "tools/buck/gen-provider-index.ts");
  const autoMapScript = path.join(repoRoot, "tools/buck/gen-auto-map.ts");
  await runNode(nodeBin, zxInit, syncScript);
  // Emit provider index for diagnostics and mapping visibility before auto_map
  await runNode(nodeBin, zxInit, providerIndexScript);
  await runNode(nodeBin, zxInit, autoMapScript, [
    "--graph",
    DEFAULT_GRAPH_PATH,
    "--out",
    "third_party/providers/auto_map.bzl",
  ]);
}
